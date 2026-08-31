use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

const COMPLETED_LEASE_LIMIT: usize = 4_096;
const SHUTDOWN_RESUME_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessIdentity {
    pub(crate) pid: u32,
    pub(crate) start_time_ms: u64,
}

pub(crate) struct SuspendProcessError<S> {
    message: String,
    pending_suspension: Option<S>,
}

impl<S> SuspendProcessError<S> {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            pending_suspension: None,
        }
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn with_pending(message: impl Into<String>, suspension: S) -> Self {
        Self {
            message: message.into(),
            pending_suspension: Some(suspension),
        }
    }
}

pub(crate) trait ProcessControlBackend {
    type Suspension;

    fn suspend_process(
        &mut self,
        process: &ProcessIdentity,
    ) -> Result<Self::Suspension, SuspendProcessError<Self::Suspension>>;

    fn adopt_suspended_process(
        &mut self,
        process: &ProcessIdentity,
    ) -> Result<Self::Suspension, String>;

    fn resume_process(&mut self, suspension: &mut Self::Suspension) -> Result<(), String>;

    fn suspension_complete(suspension: &Self::Suspension) -> bool;
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ProcessControlOutcome {
    pub(crate) success: bool,
    pub(crate) resume_required: bool,
    pub(crate) error: Option<String>,
}

impl ProcessControlOutcome {
    fn success() -> Self {
        Self {
            success: true,
            resume_required: false,
            error: None,
        }
    }

    fn failure(error: impl Into<String>, resume_required: bool) -> Self {
        Self {
            success: false,
            resume_required,
            error: Some(error.into()),
        }
    }
}

struct ActiveLease<S> {
    processes: Vec<ProcessIdentity>,
    suspensions: Vec<S>,
    fully_suspended: bool,
    complete_after_resume: bool,
}

struct CompletedLeases {
    entries: HashMap<String, Vec<ProcessIdentity>>,
    order: VecDeque<String>,
    limit: usize,
}

impl CompletedLeases {
    fn new() -> Self {
        Self::with_limit(COMPLETED_LEASE_LIMIT)
    }

    fn with_limit(limit: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            limit,
        }
    }

    fn get(&self, lease_id: &str) -> Option<&Vec<ProcessIdentity>> {
        self.entries.get(lease_id)
    }

    fn insert(&mut self, lease_id: String, processes: Vec<ProcessIdentity>) {
        if self.entries.insert(lease_id.clone(), processes).is_none() {
            self.order.push_back(lease_id);
        }
        while self.entries.len() > self.limit {
            let Some(expired) = self.order.pop_front() else {
                break;
            };
            self.entries.remove(&expired);
        }
    }

    #[cfg(test)]
    fn contains(&self, lease_id: &str) -> bool {
        self.entries.contains_key(lease_id)
    }
}

pub(crate) struct ProcessControl<B: ProcessControlBackend> {
    backend: B,
    active_leases: HashMap<String, ActiveLease<B::Suspension>>,
    completed_leases: CompletedLeases,
}

impl<B: ProcessControlBackend> ProcessControl<B> {
    pub(crate) fn new(backend: B) -> Self {
        Self {
            backend,
            active_leases: HashMap::new(),
            completed_leases: CompletedLeases::new(),
        }
    }

    pub(crate) fn suspend(
        &mut self,
        lease_id: &str,
        processes: Vec<ProcessIdentity>,
    ) -> ProcessControlOutcome {
        let processes = match canonical_processes(processes) {
            Ok(processes) => processes,
            Err(error) => return ProcessControlOutcome::failure(error, false),
        };

        if let Some(completed) = self.completed_leases.get(lease_id) {
            return ProcessControlOutcome::failure(
                if completed == &processes {
                    format!("lease {lease_id} has already been resumed")
                } else {
                    format!("lease {lease_id} was already used with different process identities")
                },
                false,
            );
        }

        if let Some(active) = self.active_leases.get(lease_id) {
            if active.processes != processes {
                return ProcessControlOutcome::failure(
                    format!("lease {lease_id} is active with different process identities"),
                    false,
                );
            }
            if active.fully_suspended {
                return ProcessControlOutcome::success();
            }
            return ProcessControlOutcome::failure(
                format!(
                    "lease {lease_id} has pending rollback work; resume it before retrying suspend"
                ),
                true,
            );
        }

        self.suspend_new_lease(lease_id, processes)
    }

    pub(crate) fn resume(
        &mut self,
        lease_id: &str,
        processes: Vec<ProcessIdentity>,
    ) -> ProcessControlOutcome {
        let processes = match canonical_processes(processes) {
            Ok(processes) => processes,
            Err(error) => return ProcessControlOutcome::failure(error, false),
        };

        if let Some(completed) = self.completed_leases.get(lease_id) {
            if completed == &processes {
                return ProcessControlOutcome::success();
            }
            return ProcessControlOutcome::failure(
                format!("lease {lease_id} was completed with different process identities"),
                false,
            );
        }

        if let Some(active) = self.active_leases.get(lease_id) {
            if active.processes != processes {
                return ProcessControlOutcome::failure(
                    format!("lease {lease_id} is active with different process identities"),
                    true,
                );
            }
            return self.resume_active_lease(lease_id);
        }

        self.resume_after_reconnect(lease_id, processes)
    }

    fn suspend_new_lease(
        &mut self,
        lease_id: &str,
        processes: Vec<ProcessIdentity>,
    ) -> ProcessControlOutcome {
        let mut suspensions = Vec::with_capacity(processes.len());
        for process in &processes {
            match self.backend.suspend_process(process) {
                Ok(suspension) => suspensions.push(suspension),
                Err(error) => {
                    if let Some(suspension) = error.pending_suspension {
                        suspensions.push(suspension);
                    }
                    let rollback_errors = self.resume_suspensions(&mut suspensions);
                    let resume_required = !suspensions.is_empty();
                    if resume_required {
                        self.active_leases.insert(
                            lease_id.to_owned(),
                            ActiveLease {
                                processes,
                                suspensions,
                                fully_suspended: false,
                                complete_after_resume: true,
                            },
                        );
                    } else {
                        // A lost failure receipt can prompt a compensating
                        // resume. Tombstone a fully rolled-back lease so that
                        // retry never decrements another component's count.
                        self.completed_leases.insert(lease_id.to_owned(), processes);
                    }
                    return ProcessControlOutcome::failure(
                        with_rollback_errors(error.message, rollback_errors),
                        resume_required,
                    );
                }
            }
        }

        self.active_leases.insert(
            lease_id.to_owned(),
            ActiveLease {
                processes,
                suspensions,
                fully_suspended: true,
                complete_after_resume: true,
            },
        );
        ProcessControlOutcome::success()
    }

    fn resume_after_reconnect(
        &mut self,
        lease_id: &str,
        processes: Vec<ProcessIdentity>,
    ) -> ProcessControlOutcome {
        let mut suspensions = Vec::with_capacity(processes.len());
        for process in &processes {
            match self.backend.adopt_suspended_process(process) {
                Ok(suspension) => suspensions.push(suspension),
                Err(error) => {
                    let rollback_errors = self.resume_suspensions(&mut suspensions);
                    if !suspensions.is_empty() {
                        self.active_leases.insert(
                            lease_id.to_owned(),
                            ActiveLease {
                                processes,
                                suspensions,
                                fully_suspended: false,
                                complete_after_resume: false,
                            },
                        );
                    }
                    return ProcessControlOutcome::failure(
                        with_rollback_errors(error, rollback_errors),
                        true,
                    );
                }
            }
        }
        self.active_leases.insert(
            lease_id.to_owned(),
            ActiveLease {
                processes,
                suspensions,
                fully_suspended: false,
                complete_after_resume: true,
            },
        );
        self.resume_active_lease(lease_id)
    }

    fn resume_active_lease(&mut self, lease_id: &str) -> ProcessControlOutcome {
        let mut lease = self
            .active_leases
            .remove(lease_id)
            .expect("active lease checked by caller");
        let errors = self.resume_suspensions(&mut lease.suspensions);

        if lease.suspensions.is_empty() {
            if !lease.complete_after_resume {
                return ProcessControlOutcome::failure(
                    format!("lease {lease_id} needs another reconnect adoption attempt"),
                    true,
                );
            }
            self.completed_leases
                .insert(lease_id.to_owned(), lease.processes);
            if errors.is_empty() {
                return ProcessControlOutcome::success();
            }
            return ProcessControlOutcome::failure(errors.join("; "), false);
        }

        self.active_leases.insert(lease_id.to_owned(), lease);
        ProcessControlOutcome::failure(
            if errors.is_empty() {
                format!("lease {lease_id} still has suspended threads")
            } else {
                errors.join("; ")
            },
            true,
        )
    }

    fn resume_suspensions(&mut self, suspensions: &mut Vec<B::Suspension>) -> Vec<String> {
        let mut errors = Vec::new();
        for suspension in suspensions.iter_mut().rev() {
            if let Err(error) = self.backend.resume_process(suspension) {
                errors.push(error);
            }
        }
        suspensions.retain(|suspension| !B::suspension_complete(suspension));
        errors
    }

    #[cfg(test)]
    fn has_active_lease(&self, lease_id: &str) -> bool {
        self.active_leases.contains_key(lease_id)
    }

    #[cfg(test)]
    fn has_completed_lease(&self, lease_id: &str) -> bool {
        self.completed_leases.contains(lease_id)
    }
}

impl<B: ProcessControlBackend> Drop for ProcessControl<B> {
    fn drop(&mut self) {
        let lease_ids = self.active_leases.keys().cloned().collect::<Vec<_>>();
        for lease_id in lease_ids {
            let Some(mut lease) = self.active_leases.remove(&lease_id) else {
                continue;
            };
            let mut errors = Vec::new();
            for _ in 0..SHUTDOWN_RESUME_ATTEMPTS {
                errors = self.resume_suspensions(&mut lease.suspensions);
                if lease.suspensions.is_empty() {
                    break;
                }
            }
            if !lease.suspensions.is_empty() {
                eprintln!(
                    "failed to resume process-control lease {lease_id} during shutdown: {}",
                    errors.join("; ")
                );
            }
        }
    }
}

fn canonical_processes(
    mut processes: Vec<ProcessIdentity>,
) -> Result<Vec<ProcessIdentity>, String> {
    if processes.is_empty() {
        return Err("process list must not be empty".to_owned());
    }
    processes.sort_by_key(|process| (process.pid, process.start_time_ms));
    let mut pids = HashSet::with_capacity(processes.len());
    for process in &processes {
        if !pids.insert(process.pid) {
            return Err(format!(
                "process list contains duplicate pid {}",
                process.pid
            ));
        }
    }
    Ok(processes)
}

fn with_rollback_errors(message: String, rollback_errors: Vec<String>) -> String {
    if rollback_errors.is_empty() {
        return message;
    }
    format!("{message}; rollback failed: {}", rollback_errors.join("; "))
}

#[cfg(any(test, target_os = "windows"))]
pub(crate) fn matches_process_start_time(actual_ms: u64, expected_ms: u64) -> bool {
    const TELEMETRY_PRECISION_MS: u64 = 1_000;
    actual_ms - (actual_ms % TELEMETRY_PRECISION_MS)
        == expected_ms - (expected_ms % TELEMETRY_PRECISION_MS)
}

#[cfg(not(target_os = "windows"))]
pub(crate) struct UnsupportedProcessControlBackend;

#[cfg(not(target_os = "windows"))]
impl ProcessControlBackend for UnsupportedProcessControlBackend {
    type Suspension = ();

    fn suspend_process(
        &mut self,
        _process: &ProcessIdentity,
    ) -> Result<Self::Suspension, SuspendProcessError<Self::Suspension>> {
        Err(SuspendProcessError::new(unsupported_message()))
    }

    fn adopt_suspended_process(
        &mut self,
        _process: &ProcessIdentity,
    ) -> Result<Self::Suspension, String> {
        Err(unsupported_message())
    }

    fn resume_process(&mut self, _suspension: &mut Self::Suspension) -> Result<(), String> {
        Err(unsupported_message())
    }

    fn suspension_complete(_suspension: &Self::Suspension) -> bool {
        true
    }
}

#[cfg(not(target_os = "windows"))]
fn unsupported_message() -> String {
    format!(
        "process suspend/resume is not supported on {}",
        std::env::consts::OS
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashSet;
    use std::rc::Rc;

    #[derive(Clone)]
    struct FakeBackend {
        calls: Rc<RefCell<Vec<String>>>,
        fail_suspend_pids: HashSet<u32>,
        fail_adopt_once_pids: Rc<RefCell<HashSet<u32>>>,
        fail_resume_once_pids: Rc<RefCell<HashSet<u32>>>,
    }

    struct FakeSuspension {
        pid: u32,
        pending: bool,
    }

    impl FakeBackend {
        fn recording(calls: Rc<RefCell<Vec<String>>>) -> Self {
            Self {
                calls,
                fail_suspend_pids: HashSet::new(),
                fail_adopt_once_pids: Rc::new(RefCell::new(HashSet::new())),
                fail_resume_once_pids: Rc::new(RefCell::new(HashSet::new())),
            }
        }
    }

    impl ProcessControlBackend for FakeBackend {
        type Suspension = FakeSuspension;

        fn suspend_process(
            &mut self,
            process: &ProcessIdentity,
        ) -> Result<Self::Suspension, SuspendProcessError<Self::Suspension>> {
            self.calls
                .borrow_mut()
                .push(format!("suspend:{}", process.pid));
            if self.fail_suspend_pids.contains(&process.pid) {
                return Err(SuspendProcessError::new(format!(
                    "failed suspending process {}",
                    process.pid
                )));
            }
            Ok(FakeSuspension {
                pid: process.pid,
                pending: true,
            })
        }

        fn adopt_suspended_process(
            &mut self,
            process: &ProcessIdentity,
        ) -> Result<Self::Suspension, String> {
            self.calls
                .borrow_mut()
                .push(format!("adopt:{}", process.pid));
            if self.fail_adopt_once_pids.borrow_mut().remove(&process.pid) {
                return Err(format!("failed adopting process {}", process.pid));
            }
            Ok(FakeSuspension {
                pid: process.pid,
                pending: true,
            })
        }

        fn resume_process(&mut self, suspension: &mut Self::Suspension) -> Result<(), String> {
            if !suspension.pending {
                return Ok(());
            }
            self.calls
                .borrow_mut()
                .push(format!("resume:{}", suspension.pid));
            if self
                .fail_resume_once_pids
                .borrow_mut()
                .remove(&suspension.pid)
            {
                return Err(format!("failed resuming process {}", suspension.pid));
            }
            suspension.pending = false;
            Ok(())
        }

        fn suspension_complete(suspension: &Self::Suspension) -> bool {
            !suspension.pending
        }
    }

    fn process(pid: u32) -> ProcessIdentity {
        ProcessIdentity {
            pid,
            start_time_ms: u64::from(pid) * 1_000,
        }
    }

    fn call_count(calls: &Rc<RefCell<Vec<String>>>, expected: &str) -> usize {
        calls
            .borrow()
            .iter()
            .filter(|call| call.as_str() == expected)
            .count()
    }

    #[test]
    fn suspend_and_resume_retries_use_each_owned_increment_once() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let mut control = ProcessControl::new(FakeBackend::recording(calls.clone()));
        let processes = vec![process(2), process(1)];

        assert!(control.suspend("lease-1", processes.clone()).success);
        assert!(control.suspend("lease-1", processes.clone()).success);
        assert_eq!(call_count(&calls, "suspend:1"), 1);
        assert_eq!(call_count(&calls, "suspend:2"), 1);

        assert!(control.resume("lease-1", processes.clone()).success);
        assert!(control.resume("lease-1", processes).success);
        assert_eq!(call_count(&calls, "resume:1"), 1);
        assert_eq!(call_count(&calls, "resume:2"), 1);
        assert!(!control.has_active_lease("lease-1"));
        assert!(control.has_completed_lease("lease-1"));
    }

    #[test]
    fn later_suspend_failure_rolls_back_every_completed_process() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let mut backend = FakeBackend::recording(calls.clone());
        backend.fail_suspend_pids.insert(3);
        let mut control = ProcessControl::new(backend);

        let outcome = control.suspend("lease-rollback", vec![process(1), process(2), process(3)]);

        assert!(!outcome.success);
        assert!(
            outcome
                .error
                .is_some_and(|error| error.contains("failed suspending process 3"))
        );
        assert!(!outcome.resume_required);
        assert_eq!(call_count(&calls, "resume:1"), 1);
        assert_eq!(call_count(&calls, "resume:2"), 1);
        assert!(!control.has_active_lease("lease-rollback"));
        assert!(control.has_completed_lease("lease-rollback"));
        assert!(
            control
                .resume("lease-rollback", vec![process(1), process(2), process(3)])
                .success
        );
        assert_eq!(call_count(&calls, "resume:1"), 1);
    }

    #[test]
    fn failed_rollback_retains_only_pending_lease_work_for_a_resume_retry() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let mut backend = FakeBackend::recording(calls.clone());
        backend.fail_suspend_pids.insert(2);
        backend.fail_resume_once_pids.borrow_mut().insert(1);
        let mut control = ProcessControl::new(backend);

        let suspend = control.suspend("lease-partial", vec![process(1), process(2)]);
        assert!(!suspend.success);
        assert!(
            suspend
                .error
                .is_some_and(|error| error.contains("rollback failed"))
        );
        assert!(suspend.resume_required);
        assert!(control.has_active_lease("lease-partial"));

        let resume = control.resume("lease-partial", vec![process(1), process(2)]);
        assert!(resume.success);
        assert_eq!(call_count(&calls, "resume:1"), 2);
        assert!(!control.has_active_lease("lease-partial"));
    }

    #[test]
    fn shutdown_retries_a_transient_resume_failure_before_releasing_handles() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let backend = FakeBackend::recording(calls.clone());
        backend.fail_resume_once_pids.borrow_mut().insert(1);

        {
            let mut control = ProcessControl::new(backend);
            assert!(control.suspend("lease-shutdown", vec![process(1)]).success);
        }

        assert_eq!(call_count(&calls, "resume:1"), 2);
    }

    #[test]
    fn reconnect_resume_adopts_threads_without_suspending_them_again() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let mut control = ProcessControl::new(FakeBackend::recording(calls.clone()));
        let processes = vec![process(1), process(2)];

        assert!(control.resume("lease-reconnect", processes.clone()).success);
        assert!(control.resume("lease-reconnect", processes).success);

        assert_eq!(call_count(&calls, "adopt:1"), 1);
        assert_eq!(call_count(&calls, "adopt:2"), 1);
        assert_eq!(call_count(&calls, "resume:1"), 1);
        assert_eq!(call_count(&calls, "resume:2"), 1);
        assert_eq!(call_count(&calls, "suspend:1"), 0);
    }

    #[test]
    fn reconnect_adoption_failure_rolls_back_and_retries_every_identity() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let backend = FakeBackend::recording(calls.clone());
        backend.fail_adopt_once_pids.borrow_mut().insert(2);
        let mut control = ProcessControl::new(backend);
        let processes = vec![process(1), process(2)];

        let first = control.resume("lease-reconnect-partial", processes.clone());
        assert!(!first.success);
        assert!(first.resume_required);
        assert_eq!(call_count(&calls, "adopt:1"), 1);
        assert_eq!(call_count(&calls, "adopt:2"), 1);
        assert_eq!(call_count(&calls, "resume:1"), 1);

        let second = control.resume("lease-reconnect-partial", processes);
        assert!(second.success);
        assert_eq!(call_count(&calls, "adopt:1"), 2);
        assert_eq!(call_count(&calls, "adopt:2"), 2);
        assert_eq!(call_count(&calls, "resume:1"), 2);
        assert_eq!(call_count(&calls, "resume:2"), 1);
    }

    #[test]
    fn rejects_a_reused_lease_with_different_process_identities() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let mut control = ProcessControl::new(FakeBackend::recording(calls));

        assert!(control.suspend("lease-mismatch", vec![process(1)]).success);
        let outcome = control.resume("lease-mismatch", vec![process(2)]);

        assert!(!outcome.success);
        assert!(
            outcome
                .error
                .is_some_and(|error| error.contains("different process identities"))
        );
        assert!(control.has_active_lease("lease-mismatch"));
    }

    #[test]
    fn rejects_duplicate_process_ids_before_touching_the_backend() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let mut control = ProcessControl::new(FakeBackend::recording(calls.clone()));

        let outcome = control.suspend(
            "lease-duplicates",
            vec![
                process(1),
                ProcessIdentity {
                    pid: 1,
                    start_time_ms: 2_000,
                },
            ],
        );

        assert!(!outcome.success);
        assert!(
            outcome
                .error
                .is_some_and(|error| error.contains("duplicate pid 1"))
        );
        assert!(calls.borrow().is_empty());
    }

    #[test]
    fn rejects_an_empty_process_tree_before_touching_the_backend() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let mut control = ProcessControl::new(FakeBackend::recording(calls.clone()));

        let suspend = control.suspend("lease-empty", Vec::new());
        let resume = control.resume("lease-empty", Vec::new());

        assert!(!suspend.success);
        assert!(!resume.success);
        assert!(
            suspend
                .error
                .is_some_and(|error| error.contains("must not be empty"))
        );
        assert!(calls.borrow().is_empty());
    }

    #[test]
    fn completed_lease_tombstones_evict_the_oldest_entry_at_the_bound() {
        let mut completed = CompletedLeases::with_limit(2);
        completed.insert("lease-1".to_owned(), vec![process(1)]);
        completed.insert("lease-2".to_owned(), vec![process(2)]);
        completed.insert("lease-3".to_owned(), vec![process(3)]);

        assert!(completed.get("lease-1").is_none());
        assert!(completed.get("lease-2").is_some());
        assert!(completed.get("lease-3").is_some());
    }

    #[test]
    fn matches_win32_creation_time_in_the_telemetry_second_bucket() {
        assert!(matches_process_start_time(123_999, 123_000));
        assert!(matches_process_start_time(123_000, 123_999));
        assert!(!matches_process_start_time(124_000, 123_999));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn unsupported_platform_rejects_process_control_without_poisoning_the_loop() {
        let mut control = ProcessControl::new(UnsupportedProcessControlBackend);

        let suspend = control.suspend("lease-unsupported-suspend", vec![process(1)]);
        let resume = control.resume("lease-unsupported-resume", vec![process(1)]);

        assert!(!suspend.success);
        assert!(!resume.success);
        assert!(!suspend.resume_required);
        assert!(resume.resume_required);
        assert!(
            suspend
                .error
                .is_some_and(|error| error.contains("not supported"))
        );
        assert!(
            resume
                .error
                .is_some_and(|error| error.contains("not supported"))
        );
    }
}
