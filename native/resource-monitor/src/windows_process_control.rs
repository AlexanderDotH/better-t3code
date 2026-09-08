use crate::process_control::{
    ProcessControlBackend, ProcessIdentity, SuspendProcessError, matches_process_start_time,
};
use std::io;
use std::mem::size_of;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_INVALID_PARAMETER, ERROR_NO_MORE_FILES, FILETIME, GetLastError, HANDLE,
    INVALID_HANDLE_VALUE, STILL_ACTIVE,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeThread, GetProcessIdOfThread, GetProcessTimes, OpenProcess, OpenThread,
    PROCESS_QUERY_LIMITED_INFORMATION, ResumeThread, SuspendThread,
    THREAD_QUERY_LIMITED_INFORMATION, THREAD_SUSPEND_RESUME,
};

const FAILED_SUSPEND_COUNT: u32 = u32::MAX;
const WINDOWS_TO_UNIX_EPOCH_100NS: u64 = 116_444_736_000_000_000;
const HUNDRED_NS_PER_MS: u64 = 10_000;

pub(crate) struct WindowsProcessControlBackend;

pub(crate) struct SuspendedProcess {
    pid: u32,
    threads: Vec<OwnedThread>,
}

struct OwnedThread {
    id: u32,
    handle: OwnedHandle,
    pending_increment: bool,
}

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn from_snapshot(handle: HANDLE) -> Result<Self, String> {
        if handle == INVALID_HANDLE_VALUE {
            return Err(last_error("creating the thread snapshot"));
        }
        Ok(Self(handle))
    }

    fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: this wrapper is the sole owner of a valid Win32 handle and
        // closes it exactly once when the wrapper is dropped.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

impl ProcessControlBackend for WindowsProcessControlBackend {
    type Suspension = SuspendedProcess;

    fn suspend_process(
        &mut self,
        process: &ProcessIdentity,
    ) -> Result<Self::Suspension, SuspendProcessError<Self::Suspension>> {
        let mut suspension =
            open_process_threads(process, false).map_err(SuspendProcessError::new)?;
        for index in 0..suspension.threads.len() {
            let thread = &mut suspension.threads[index];
            match thread_has_exited(thread) {
                Ok(true) => continue,
                Ok(false) => {}
                Err(error) => return Err(rollback_suspend_failure(suspension, error)),
            }
            // SAFETY: the handle was opened with THREAD_SUSPEND_RESUME and is
            // kept alive by OwnedThread for the full duration of the call.
            let previous_count = unsafe { SuspendThread(thread.handle.raw()) };
            if previous_count != FAILED_SUSPEND_COUNT {
                thread.pending_increment = true;
                continue;
            }

            // SAFETY: GetLastError is read immediately after SuspendThread
            // reports failure, before formatting or another Win32 call.
            let error = unsafe { GetLastError() };
            let suspend_error = os_error(
                &format!(
                    "suspending thread {} of process {}",
                    thread.id, suspension.pid
                ),
                error,
            );
            return Err(rollback_suspend_failure(suspension, suspend_error));
        }
        Ok(suspension)
    }

    fn adopt_suspended_process(
        &mut self,
        process: &ProcessIdentity,
    ) -> Result<Self::Suspension, String> {
        open_process_threads(process, true)
    }

    fn resume_process(&mut self, suspension: &mut Self::Suspension) -> Result<(), String> {
        resume_owned_threads(suspension)
    }

    fn suspension_complete(suspension: &Self::Suspension) -> bool {
        suspension_complete(suspension)
    }
}

fn open_process_threads(
    process: &ProcessIdentity,
    pending_increment: bool,
) -> Result<SuspendedProcess, String> {
    if !verify_process_identity(process)? {
        return Ok(SuspendedProcess {
            pid: process.pid,
            threads: Vec::new(),
        });
    }
    let thread_ids = enumerate_thread_ids(process.pid)?;
    let mut threads = Vec::with_capacity(thread_ids.len());
    for thread_id in thread_ids {
        let Some(thread) = open_owned_thread(process, thread_id, pending_increment)? else {
            continue;
        };
        threads.push(thread);
    }
    Ok(SuspendedProcess {
        pid: process.pid,
        threads,
    })
}

fn enumerate_thread_ids(pid: u32) -> Result<Vec<u32>, String> {
    // SAFETY: CreateToolhelp32Snapshot has no borrowed pointer arguments; the
    // returned handle is immediately placed under OwnedHandle ownership.
    let snapshot =
        OwnedHandle::from_snapshot(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) })?;
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..THREADENTRY32::default()
    };
    let mut thread_ids = Vec::new();

    // SAFETY: entry points to a correctly sized, writable THREADENTRY32 and
    // snapshot remains valid for the complete enumeration.
    if unsafe { Thread32First(snapshot.raw(), &mut entry) } == 0 {
        // SAFETY: GetLastError is read immediately after the failed Win32 call.
        let error = unsafe { GetLastError() };
        if error == ERROR_NO_MORE_FILES {
            return Ok(thread_ids);
        }
        return Err(os_error("starting thread enumeration", error));
    }

    loop {
        if entry.th32OwnerProcessID == pid {
            thread_ids.push(entry.th32ThreadID);
        }
        // SAFETY: the same initialized entry and live snapshot are reused for
        // the next ToolHelp row, as required by Thread32Next.
        if unsafe { Thread32Next(snapshot.raw(), &mut entry) } != 0 {
            continue;
        }
        // SAFETY: GetLastError is read immediately after Thread32Next fails.
        let error = unsafe { GetLastError() };
        if error != ERROR_NO_MORE_FILES {
            return Err(os_error("continuing thread enumeration", error));
        }
        break;
    }

    thread_ids.sort_unstable();
    thread_ids.dedup();
    Ok(thread_ids)
}

fn open_owned_thread(
    process: &ProcessIdentity,
    thread_id: u32,
    pending_increment: bool,
) -> Result<Option<OwnedThread>, String> {
    // SAFETY: OpenThread receives a concrete thread id and requests only the
    // rights needed to fence, suspend, resume, and inspect that thread.
    let raw_handle = unsafe {
        OpenThread(
            THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION,
            0,
            thread_id,
        )
    };
    if raw_handle.is_null() {
        // SAFETY: GetLastError is read immediately after OpenThread fails.
        let error = unsafe { GetLastError() };
        if error == ERROR_INVALID_PARAMETER {
            return Ok(None);
        }
        return Err(os_error(
            &format!("opening thread {thread_id} of process {}", process.pid),
            error,
        ));
    }
    let handle = OwnedHandle(raw_handle);
    let thread = OwnedThread {
        id: thread_id,
        handle,
        pending_increment,
    };
    if thread_has_exited(&thread)? {
        return Ok(None);
    }

    // SAFETY: the live thread handle remains owned by `thread` while its
    // immutable owning process id is queried.
    let owner_pid = unsafe { GetProcessIdOfThread(thread.handle.raw()) };
    if owner_pid == 0 {
        // SAFETY: GetLastError is read immediately after the failed owner query.
        let error = unsafe { GetLastError() };
        return Err(os_error(
            &format!("reading owner of thread {thread_id}"),
            error,
        ));
    }
    if owner_pid != process.pid {
        return Err(format!(
            "thread {thread_id} owner changed from process {} to {owner_pid}",
            process.pid
        ));
    }
    if !verify_process_identity(process)? {
        return Ok(None);
    }
    Ok(Some(thread))
}

fn verify_process_identity(process: &ProcessIdentity) -> Result<bool, String> {
    // SAFETY: OpenProcess receives a concrete pid and requests read-only query
    // access. The returned handle is immediately owned by OwnedHandle.
    let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process.pid) };
    if raw_handle.is_null() {
        // SAFETY: GetLastError is read immediately after OpenProcess fails.
        let error = unsafe { GetLastError() };
        if error == ERROR_INVALID_PARAMETER {
            return Ok(false);
        }
        return Err(os_error(
            &format!("opening process {} for identity verification", process.pid),
            error,
        ));
    }
    let handle = OwnedHandle(raw_handle);
    let actual_start_time_ms = process_creation_time_ms(&handle)?;
    if matches_process_start_time(actual_start_time_ms, process.start_time_ms) {
        return Ok(true);
    }
    Err(format!(
        "process {} creation time mismatch: expected {} ms, found {} ms",
        process.pid, process.start_time_ms, actual_start_time_ms
    ))
}

fn process_creation_time_ms(process: &OwnedHandle) -> Result<u64, String> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: all FILETIME pointers refer to initialized writable values and
    // the queried process handle remains valid for the duration of the call.
    if unsafe {
        GetProcessTimes(
            process.raw(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    } == 0
    {
        return Err(last_error("reading process creation time"));
    }
    Ok(filetime_to_unix_ms(creation))
}

fn filetime_to_unix_ms(value: FILETIME) -> u64 {
    let ticks = (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime);
    ticks.saturating_sub(WINDOWS_TO_UNIX_EPOCH_100NS) / HUNDRED_NS_PER_MS
}

fn resume_owned_threads(suspension: &mut SuspendedProcess) -> Result<(), String> {
    let mut errors = Vec::new();
    for thread in suspension.threads.iter_mut().rev() {
        if !thread.pending_increment {
            continue;
        }
        let exit_state_error = match thread_has_exited(thread) {
            Ok(true) => {
                thread.pending_increment = false;
                continue;
            }
            Ok(false) => None,
            Err(error) => Some(error),
        };

        // SAFETY: this live handle was opened with THREAD_SUSPEND_RESUME. A
        // successful call consumes exactly the one increment owned by lease.
        if unsafe { ResumeThread(thread.handle.raw()) } != FAILED_SUSPEND_COUNT {
            thread.pending_increment = false;
            continue;
        }

        // SAFETY: GetLastError is read immediately after ResumeThread fails.
        let resume_error = unsafe { GetLastError() };
        let resume_failure = os_error(
            &format!(
                "resuming thread {} of process {}",
                thread.id, suspension.pid
            ),
            resume_error,
        );

        match thread_has_exited(thread) {
            Ok(true) => thread.pending_increment = false,
            Ok(false) => {
                let mut error = resume_failure;
                if let Some(exit_state_error) = exit_state_error {
                    error.push_str("; ");
                    error.push_str(&exit_state_error);
                }
                errors.push(error);
            }
            Err(error) => {
                let mut combined = resume_failure;
                if let Some(exit_state_error) = exit_state_error {
                    combined.push_str("; ");
                    combined.push_str(&exit_state_error);
                }
                combined.push_str("; ");
                combined.push_str(&error);
                errors.push(combined);
            }
        }
    }

    if errors.is_empty() {
        return Ok(());
    }
    Err(errors.join("; "))
}

fn thread_has_exited(thread: &OwnedThread) -> Result<bool, String> {
    let mut exit_code = 0u32;
    // SAFETY: the thread handle was opened with query access and exit_code is
    // a valid writable u32 for the duration of GetExitCodeThread.
    if unsafe { GetExitCodeThread(thread.handle.raw(), &mut exit_code) } == 0 {
        // SAFETY: GetLastError is read immediately after GetExitCodeThread fails.
        let error = unsafe { GetLastError() };
        return Err(os_error(
            &format!("reading exit state of thread {}", thread.id),
            error,
        ));
    }
    Ok(exit_code != STILL_ACTIVE as u32)
}

fn suspension_complete(suspension: &SuspendedProcess) -> bool {
    suspension
        .threads
        .iter()
        .all(|thread| !thread.pending_increment)
}

fn rollback_suspend_failure(
    mut suspension: SuspendedProcess,
    message: String,
) -> SuspendProcessError<SuspendedProcess> {
    let rollback_error = resume_owned_threads(&mut suspension).err();
    let message = append_rollback_error(message, rollback_error);
    if suspension_complete(&suspension) {
        return SuspendProcessError::new(message);
    }
    SuspendProcessError::with_pending(message, suspension)
}

fn append_rollback_error(message: String, rollback_error: Option<String>) -> String {
    match rollback_error {
        Some(error) => format!("{message}; rollback failed: {error}"),
        None => message,
    }
}

fn last_error(action: &str) -> String {
    format!("{action}: {}", io::Error::last_os_error())
}

fn os_error(action: &str, code: u32) -> String {
    format!("{action}: {}", io::Error::from_raw_os_error(code as i32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_control::ProcessControl;
    use std::process::{Child, Command, Stdio};

    struct ChildFixture(Child);

    impl Drop for ChildFixture {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn fences_suspends_and_resumes_a_spawned_process() {
        let child = ChildFixture(
            Command::new("cmd.exe")
                .args(["/Q", "/D"])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn cmd.exe fixture"),
        );
        let pid = child.0.id();
        let start_time_ms = creation_time_for_pid(pid);
        let identity = ProcessIdentity { pid, start_time_ms };
        let mut control = ProcessControl::new(WindowsProcessControlBackend);

        let stale = control.suspend(
            "stale-lease",
            vec![ProcessIdentity {
                start_time_ms: start_time_ms.saturating_add(1_000),
                ..identity.clone()
            }],
        );
        assert!(!stale.success);
        assert!(
            stale
                .error
                .is_some_and(|error| error.contains("creation time mismatch"))
        );

        assert!(control.suspend("lease-1", vec![identity.clone()]).success);
        assert!(control.resume("lease-1", vec![identity]).success);

        drop(control);
    }

    fn creation_time_for_pid(pid: u32) -> u64 {
        // SAFETY: the test owns the child process and asks only for read-only
        // process metadata access.
        let raw_handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        let handle = OwnedHandle::from_nullable_for_test(raw_handle);
        process_creation_time_ms(&handle).expect("read cmd.exe creation time")
    }

    impl OwnedHandle {
        fn from_nullable_for_test(handle: HANDLE) -> Self {
            assert!(
                !handle.is_null(),
                "open cmd.exe fixture: {}",
                last_error("")
            );
            Self(handle)
        }
    }
}
