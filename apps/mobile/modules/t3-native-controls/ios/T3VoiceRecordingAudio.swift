import AVFAudio

enum T3VoiceRecordingAudio {
  static func configure() throws {
    let session = AVAudioSession.sharedInstance()
    // A2DP plus a local microphone keeps other apps' music out of the headset call profile.
    try session.setCategory(.playAndRecord, mode: .default,
                            options: [.mixWithOthers, .allowBluetoothA2DP])
    if let microphone = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
      try session.setPreferredInput(microphone)
    }
  }

  static func clearPreferredInput() throws {
    try AVAudioSession.sharedInstance().setPreferredInput(nil)
  }
}
