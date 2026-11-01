# The screenshot path, end to end without a provider (#37)

This directory records a measurement of the screenshot feature as a person uses it: picking a region in the page, including it from the sidebar, and what the request to a provider would contain. It stops short of a paid model call. The provider is a stub on loopback that records the request and answers with an error, so nothing of the user's is spent and no credential is read.

Measured on 2026-11-01 in Firefox 159.0 (flatpak build, SteamOS) with the window's device pixel ratio at 1.5 and the extension built from commit 76d9244.

## Result

The screenshot path works as designed in every case that was driven, with two exceptions that the measurements show. The paid end-to-end call, which would show how a real model answers a screenshot, is not part of this and comes later.

| Question | Result |
|---|---|
| Does the image match the drawn region? | Yes within 1 CSS pixel on every edge at device pixel ratios of 1, 1.5 and 2, after the page scrolled, and for a region drawn with the "Add a screenshot" button. Exception: a region of 640 by 680 CSS pixels at a ratio of 2 is 1.06 CSS pixels short at its right and bottom edges. |
| Is the wrong tab ever captured? | No. A request for a tab that is not in front, and a request with another address than the tab's, are refused with a message and return no image. |
| Is the all-sites grant handed back? | Yes. It is not held before the screenshot, is held while the image is taken, and is not held after the panel's Cancel button ends the run. |
| Is anything sent without Generate? | No. The stub provider received no request while the screenshot was taken. After Generate it received one request, and the image in it is byte-identical to the one the panel showed. |
| Does the next request carry the image? | No. After a failed first request the panel no longer shows the image, and the second request has none. |
| Do the extension's own overlays appear in the image? | No, in a normal single action. In one run an action that was triggered twice by accident returned an image with the lock fill in it (see below). |

## Method

`probe.mjs` drives the real sidebar and the real picker in the development Firefox over the remote debugging protocol.

- The page is a grid of 40 by 40 CSS pixel cells served from `http://localhost:8793/`. Red alternates between 20 and 230 by column and green by row, and blue is always 128. Every edge between two cells is a step in one channel, so the image shows where on the page it starts and ends to a fraction of a pixel, and a pixel whose blue differs from 128 was not drawn by the page.
- Input is trusted. The picker ignores events that a page script sends, and `permissions.request` needs a user input handler. The probe sends mouse events from the chrome-privileged global of the process that holds the window with `windowUtils.dispatchDOMEventViaPresShellForTesting`. It reads the positions back from a listener in the page, so a position that was converted wrongly shows in the output.
- The prompt for the all-sites grant is switched off for the run with the preference `extensions.webextOptionalPermissionPrompts`, so that the request is granted without a dialog. The request still has to come from a real click, which is what the trusted events provide.
- The active provider is replaced by the stub for the run. The settings, the first-run acknowledgement, the preference and the grant are put back at the end, and the probe checks that the settings are identical to the saved copy.
- Image analysis runs in the browser on the image that the panel shows. The probe reads a row and a column through the middle of the image and finds the edges between cells.

Zoom is set with `tabs.setZoom`, which gives device pixel ratios of 1.0, 1.5 and 2.0 on this display.

## Measurements

| Case | Region (CSS px) | Ratio | Image | Left, top edge | Right, bottom edge |
|---|---|---|---|---|---|
| Zoom 2/3 | 120, 80, 200 × 150 | 1.0 | 200 × 150 | 119.50, 79.31 | 319.50, 229.31 |
| Zoom 1 | 120, 80, 200 × 150 | 1.5 | 300 × 225 | 120.00, 80.00 | 320.00, 230.00 |
| Zoom 4/3 | 120, 80, 200 × 150 | 2.0 | 398 × 299 | 120.13, 80.25 | 319.13, 229.75 |
| Zoom 1, scrolled 80 px after the pick | 120, 80, 200 × 150 | 1.5 | 300 × 225 | 120.00, 80.00 | 320.00, 230.00 |
| Zoom 4/3, scrolled 80 px after the pick | 120, 80, 200 × 150 | 2.0 | 398 × 299 | 120.13, 80.00 | 319.13, 229.50 |
| Region mode | 200, 160, 160 × 120 | 1.5 | 240 × 180 | 200.00, 160.00 | 360.00, 280.00 |
| Zoom 4/3, large region | 20, 20, 640 × 680 | 2.0 | 1276 × 1356 | 20.94, 20.94 | 658.94, 698.94 |

The edges are page positions in CSS pixels at which the image starts and ends, read from the cell edges inside it, so the region's own edges are the values in the second column added together. In the scrolled cases the page scrolled after the region was drawn, and the expected edges are the page position the region had when it was drawn, so the panel's move of the region by the scroll amount is part of what is measured. The panel showed its note that the area moved in both cases and not in the others.

The large region has cell edges 1.995 device pixels per CSS pixel apart where 2.000 is expected, so the image is resampled by about 0.25 percent. Its width is 1276 pixels where 1280 is expected, and the edge position drifts by 1.5 CSS pixels from one side of the image to the other. The request was sent with a viewport width of 686, which is the rounded value of 685.5, and the crop uses that number to convert CSS pixels to device pixels (`captureRegion` in `src/background/index.ts`). The cause was not isolated further than that.

## Controls

| Control | Result |
|---|---|
| The grant is not held when the run starts | Passes |
| Two raw captures with no overlay agree on the count of pixels that are not grid colours (3245, the page's horizontal scrollbar) | Passes |
| A raw capture taken while the picker shows its overlay has far more such pixels (2,598,392) | Passes, so the analysis can see the overlay |
| The other tab is in front when the wrong-tab request is made | Passes |
| The same request with the right tab in front returns an image | Passes |
| The page saw trusted mouse events at the positions that were intended | Passes in every case |
| One action sent exactly one `capture-region` request | Passes in every case except the deliberate double click |
| No scroll note appears when the page did not scroll | Passes in every case |
| A region inside the viewport is not reported as clipped | Passes in every case |
| A model that reads images gets the screenshot controls | Passes |
| The settings after the run are identical to the saved copy | Passes |

## Clipped regions and the model gate

A region that ends below the viewport (120, 700, 200 × 500 at a ratio of 1.5) is reported as clipped, and the image is 254.7 CSS pixels tall where the region is 500. That image contains 1500 pixels that are not grid colours. They are the page's horizontal scrollbar, which the region reaches, and the probe reports the count without asserting it. A provider whose model does not read images (`supportsVision` false) gets no screenshot controls in the panel.

## What was found

- Two overlapping capture requests can return an image that contains the extension's lock fill. In one run the test harness sent every click twice by mistake. Two `capture-region` requests were sent about 2 milliseconds apart, and the page showed the extension's overlay removed at the first request's start and added again before the second request's capture, so the second image was tinted (a 10 percent fill of the accent colour over the whole region). A deliberate double click in a later run sent two requests and returned a clean image, so the race is real in the code and was seen once. `captureWithLockDown` in `src/background/index.ts` hides the layer and shows it again for each request, and nothing serialises two requests.
- A large region at a device pixel ratio of 2 comes back resampled, as described above.
- No limit applies to the size of an image. The largest one in this run was 1276 × 1356 pixels and 50 KB, which is small because the grid is flat colour. A photograph of the same size would be larger by a factor that was not measured.

## What was not verified

- A real provider and a real model. The stub returns an error, so what a model does with the image is untested.
- Firefox for Android. The probe needs a desktop browser. The background refuses `capture-region` on Android in code, and the panel's own check (`screenshotsAvailable`) was not exercised there.
- The permission prompt. The preference that skips it was set, so the dialog's wording and its Cancel path were not seen. The request still came from a real click.
- Whether `<all_urls>` held during a run hides a narrower request that a later save needs (point 3 in the issue's second comment).
- Cross-origin frames inside the region, and the provider being named in the consent text (points 4 and 8 to 10 of that comment).
- The state after the sidebar or the browser closes during a run (tracked in #134).
- A display with a device pixel ratio of exactly 2 at 100 percent zoom. The ratio of 2 here comes from page zoom on a display with a ratio of 1.5.

## Reproducing

The probe needs the development Firefox from `npm run start:firefox`, the host permission for `http://localhost/*` (granted from the parent process with `ExtensionPermissions.add`), and a Node version that can run the files directly. It opens the sidebar with `SidebarController.show`, which moves nothing outside the development window.

```
WA_RDP_PORT=<port> node test/screenshot/probe.mjs
CASES=shot-zoom-100 WA_RDP_PORT=<port> node test/screenshot/probe.mjs
```

`CASES` takes a comma-separated list of case labels and skips the second and third parts of the run. A full run takes about seven minutes. The exit status is 1 when a row of the verdict fails, which is the case for the large region at present.

| File | Purpose |
|---|---|
| `probe.mjs` | The run, the controls and the verdict |
| `drive.mjs` | Trusted input, image analysis and the placement of an image on the page |
| `server.mjs` | The grid page, a second page, and the stub provider |
