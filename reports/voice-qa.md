# Voice QA

## Result

```text
Chrome installed: PASS (Google Chrome 155.0.8059.80)
Voice-first UI source wiring: PASS
Voice-device centerpiece: PASS (PACT Core CSS sphere states idle/listening/thinking/speaking/approval/approved/denied)
Premium visual treatment: PASS (near-black navy glass, layered 3D/radial sphere, floor reflection, state rings, speaking waveform)
Push-to-talk recognition hook: PASS (`SpeechRecognition` / `webkitSpeechRecognition`)
Browser speech synthesis hook: PASS (`speechSynthesis` / `SpeechSynthesisUtterance`)
Visible transcript markup and response card: PASS
Typed fallback: PASS
Maya multi-turn command pipeline: PASS
Dad approval response text: PASS
Shared-screen private response: PASS; response is “That’s private.”
Alexa proprietary voice/branding: PASS; no Alexa voice or logo is used
Live microphone/audio manual execution: NOT RUN
```

The current server was restarted on `http://127.0.0.1:8787` and the page was
opened in the installed Chrome browser. The API/command QA verified the four
Maya turns, the exact Dad approval response, and the private shared-surface
response. The UI contains the visible `SIMULATED ALEXA+ ADD-ON` label and
routes typed and recognized text through the same command pipeline.

The orb is PACT-native CSS/HTML with cyan, violet, and amber state lighting;
it uses no Amazon, Echo, Alexa, or copied visual assets.

Live microphone capture and audible speech could not be independently
confirmed by this non-interactive QA runner: no browser automation or human
microphone harness is available. This is intentionally recorded as NOT RUN,
not as a claimed voice integration. Manual verification is:

1. In Chrome, open `http://127.0.0.1:8787` and grant microphone permission.
2. Press **Push to talk**, say “Plan Maya’s birthday under $150,” and confirm
   the transcript and spoken response appear together.
3. Run the Maya demo; verify Dad’s approval response is spoken and the final
   GiftCart response is DENY.
4. Use **Try private routing** on the shared surface and verify only “That’s
   private.” is spoken; use typed fallback if recognition is unavailable.

No Alexa branding, proprietary voice imitation, real identity, purchase,
booking, device, or production Alexa+ integration is present.
