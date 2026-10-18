# pact-signal performance

Measured in headless Chromium at 1440×900 with the local Vite demo, over 10
seconds per run. Browser `PerformanceObserver` reported no long tasks; the
render loop stayed at the display cadence in both cases.

| particles | frames | elapsed | measured FPS | long-task ms/frame |
| ---: | ---: | ---: | ---: | ---: |
| 3,000 | 602 | 10,014.6 ms | 60.11 | 0.00 |
| 8,000 | 601 | 10,000.6 ms | 60.10 | 0.00 |

These are browser-frame and long-task measurements, not a claim about every
GPU or device. The demo slider recreates the signal with the selected count.
