# The screenshot path, end to end without a provider (#37)

This directory records a measurement of the screenshot feature as a person uses it: picking a region in the page, including it from the sidebar, and what the request to a provider would contain. It stops short of a paid model call. The provider is a stub on loopback that records the request and answers with an error, so nothing of the user's is spent and no credential is read.

Measured on 2026-11-01 in Firefox 159.0 (flatpak build, SteamOS) with the window's device pixel ratio at 1.5 and the extension built from commit 76d9244.

## Result

The screenshot path works as designed in every case that was driven, with the defects that the sections below list. The crop was fixed on 2026-11-02 and is measured before and after. The paid end-to-end call, which shows how a real model answers a screenshot, was made on 2026-11-02 and is recorded in the section on the paid run.

| Question | Result |
|---|---|
| Does the image match the drawn region? | Yes, to within one device pixel on every edge, at page zooms that give ratios of 1.0, 1.5, 1.8 and 2.0, with a region of 640 by 680 CSS pixels and one of 200 by 150, and after the page scrolled. This was not so before the fix of the crop: see the section on the crop. |
| Is the wrong tab ever captured? | No. A request for a tab that is not in front, and a request with another address than the tab's, are refused with a message and return no image. |
| Is the all-sites grant handed back? | Yes. It is not held before the screenshot, is held while the image is taken, and is not held after the panel's Cancel button ends the run. |
| Is anything sent without Brew? | No. The stub provider received no request while the screenshot was taken. After Brew it received one request, and the image in it is byte-identical to the one the panel showed. |
| Does the next request carry the image? | No. After a failed first request the panel no longer shows the image, and the second request has none. |
| Do the extension's own overlays appear in the image? | No. In one earlier run an action that was triggered twice by accident returned an image with the lock fill in it. That was not reproduced in 136 images from pairs of overlapping requests, and requests for one tab now wait for each other (see the section on overlapping capture requests). |

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

The large region has cell edges 1.995 device pixels per CSS pixel apart where 2.000 was expected. The first version of this note took that for resampling by the crop. It is the scale of the capture itself, as the section on the crop shows. The edge positions in the table above were computed with a scale of 2.000 and are therefore off by up to 1 CSS pixel at the far side of a large region; the section on the crop gives the positions again with the scale that was measured.

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

## The crop (#37, fixed)

The first measurement reported a region of 640 by 680 CSS pixels at a ratio of 2 as 4 device pixels short (1276 by 1356 where 1280 by 1360 were expected) and as resampled. Re-measured on 2026-11-02 in Firefox 159.0 with `crop.mjs`, which asks for each region the way the panel does and analyses the image that comes back.

### What the capture is

The scale of a capture is not the page's device pixel ratio. `crop.mjs` fits the scale from the cell edges in a raw `captureVisibleTab` image of the whole viewport (17 to 34 edges across), and finds these values.

| Page zoom | Page's ratio | Capture, device pixels | Capture's scale, pixels per CSS pixel |
|---|---|---|---|
| 2/3 | 1.0000 | 1377 × 1440 | 1.0051 |
| 1 | 1.5000 | 1371 × 1434 | 1.5000 |
| 6/5 | 1.8182 | 1359 × 1420 | 1.8000 |
| 4/3 | 2.0000 | 1368 × 1430 | 1.9951 |

At a page zoom of 4/3 the capture has 1.9951 pixels for each CSS pixel, so a region of 640 CSS pixels is 1276.9 pixels wide in it, and an image of 1276 pixels is correct for the scale that Firefox used. The 4 pixels were not lost by the extension. Firefox's own crop does the same: `captureVisibleTab` with its `rect` option returned 1276 by 1356 for the same region (measured, and not used). The measured scale is close to 1.5 × 1.33, which suggests that the capture uses the zoom step of 133 percent where the page's ratio uses 4/3; that was not checked in Firefox's code.

### Cause of the error that the extension did add

The crop scaled the region by `bitmap.width / viewportWidth`, where the width is the content script's `window.innerWidth`. A content script reads that as a whole number, and the page reads it with its fraction: 686 against 685.5 at a ratio of 2. The source rectangle that this gave was fractional, and `drawImage` with a fractional source rectangle resamples. Measured before the fix with the scale of the capture as the reference:

| Case | Region, CSS px | Image | Image ends at, CSS px | Error at the far edge |
|---|---|---|---|---|
| Ratio 1.0 | 20, 20, 640 × 680 | 642 × 682 | 658.75, 698.64 | 1.37 px short |
| Ratio 2.0 | 20, 20, 640 × 680 | 1276 × 1356 | 659.60, 699.65 | 0.80 px short |
| Ratio 2.0 | 120, 80, 200 × 150 | 398 × 299 | 319.12, 229.75 | 1.75 px short |
| Ratio 2.0, scrolled 80 | 20, 100, 640 × 600 | 1276 × 1196 | 659.60, 699.53 | 0.95 px short |

The images at ratios 1.0 and 2.0 had at least one pixel between two cells at some edge, and the images at ratios 1.5 and 1.8 had none (the metric counts pixels that are more than 3 levels from both cell values, so it is crude). The images at ratios 1.0 and 2.0 are the ones with a fractional source rectangle.

### Fix

The content script now also reports the viewport size without rounding (`visualViewport` plus the scrollbar width, from `get-viewport`), and the background asks for it at capture time. `cropWindow` in `src/shared/region.ts` scales by the size of the capture over that size, taken from the width and the height together, and rounds the four edges to whole device pixels, so the copy is pixel for pixel. A region that reaches more than one CSS pixel past the capture is reported as clipped.

### Measurements after the fix

The reference is the scale in the first table. An error is in device pixels. A case passes when the image starts and ends at the region's edges within one device pixel, its sides are the region's sides times the scale within one device pixel, no edge is blurred (at most one pixel between two cells), and no pixel is outside the grid colours.

| Case | Region, CSS px | Image before | Image after | Image ends at after, CSS px | Error at the far edge after |
|---|---|---|---|---|---|
| Ratio 1.0 | 20, 20, 640 × 680 | 642 × 682 | 643 × 683 | 659.68, 699.57 | 0.43 px |
| Ratio 1.5 | 20, 20, 640 × 680 | 960 × 1020 | 960 × 1020 | 660.00, 700.00 | 0.00 px |
| Ratio 1.8 | 20, 20, 640 × 680 | 1153 × 1225 | 1153 × 1225 | 660.56, 700.56 | 1.00 px |
| Ratio 2.0 | 20, 20, 640 × 680 | 1276 × 1356 | 1277 × 1357 | 660.16, 700.22 | 0.43 px |
| Ratio 1.5 | 120, 80, 200 × 150 | 300 × 225 | 300 × 225 | 320.00, 230.00 | 0.00 px |
| Ratio 2.0 | 120, 80, 200 × 150 | 398 × 299 | 400 × 299 | 320.30, 230.00 | 0.60 px |
| Ratio 1.5, scrolled 80 | 20, 100, 640 × 600 | 960 × 900 | 960 × 900 | 660.00, 700.00 | 0.00 px |
| Ratio 2.0, scrolled 80 | 20, 100, 640 × 600 | 1276 × 1196 | 1277 × 1197 | 660.16, 700.09 | 0.32 px |

All eight cases pass after the fix, and no image has a pixel between two cells. Before it, three cases failed a one-pixel test: ratio 1.0 and the small region at ratio 2.0 failed both the far edge and the sides, and the scrolled region at ratio 2.0 failed the sides. The largest remaining error is 1.00 pixel, at ratio 1.8 (this one was 1.00 before as well), and the image starts 1.00 pixel off for the small region at ratio 2.0. These errors come from the sides of the capture being whole numbers: at a ratio of 1.8 the capture is 1359 pixels wide for a viewport of 754.05 CSS pixels, which is 1.8022, where the true scale is 1.8000. A crop that is exact to the pixel needs the capture's true scale, which the page and the extension cannot read.

The whole of `probe.mjs`, which drives the real sidebar and picker, passes after the fix, with the large region now 1277 by 1357 pixels and the edge checks made against the fitted scale and a tolerance of one device pixel (they were made against the page's ratio and a tolerance of one CSS pixel, which is why the large region failed before).

Controls: the scale is taken from a raw capture and not from a small region's few edges (a small region at ratio 2 gave a fitted scale of 2.0000 from five edges where the viewport's 17 edges give 1.9951); the images at ratios 1.5 and 1.8, which a fractional rectangle does not affect at these sizes, are the control that shows the blur metric returns none for an image that was copied cleanly; the grant that `captureVisibleTab` needs is held only for the run and the probe checks that it is back as before; the unit tests in `src/shared/region.test.ts` and `src/background/capture.test.ts` check the same sizes from the numbers in the first table.

## Overlapping capture requests (#37, fixed)

`captureWithLockDown` hid the extension's overlay in the page, took the image and showed the overlay again, once for each request, and nothing made two requests for one tab wait for each other. When the first request showed the overlay again before the second had captured, the second image would contain it. The extension now keeps one queue for each tab (`createSerialQueue` in `src/shared/serial.ts`), so that the hide, capture and show of one request finish before the next request for that tab starts, and a request for another tab does not wait.

### What was measured

- Unit tests (`src/background/capture.test.ts`, `src/shared/serial.test.ts`) run the real background code with a stubbed browser. With the first capture held open and a second request sent for the same tab, the page receives `hide`, then the capture, then `show`, and only then the second request's `hide`, capture and `show`. The control is two requests for different tabs, which are not queued together and which do overlap (`hide`, `hide`, `show`). A request that fails does not stop the one behind it.
- `probe.mjs` sends pairs of `capture-region` requests from an extension page while the sidebar's picked area is on screen, with the second request sent 0, 5, 20, 40, 60, 80, 100 or 200 ms after the first (one request takes 39 to 48 ms), twice at each delay, and analyses every image for pixels that are not grid colours. The control is that the analysis finds the overlay: a raw capture with the overlay shown has about 1.96 million such pixels, against 3245 for the page's scrollbar alone, so a tinted image would be seen.

### Results

| Build | Pairs | Images with pixels of the overlay | Overlay shown again afterwards |
|---|---|---|---|
| Before the queue (commit 92e348f), zoom 1 | 18 delays from 0 to 250 ms, twice each, 72 images | 0 | Yes |
| After the queue, zoom 1 | 8 delays, twice each, 32 images | 0 | Yes (1,966,014 pixels) |
| After the queue, zoom 4/3 | 8 delays, twice each, 32 images | 0 | Yes (1,956,240 pixels) |

The race was not reproduced live. The tint that the first session saw once came from a harness that sent every click twice, with the two requests about 2 ms apart; in this run, requests 0 to 250 ms apart on the build before the queue returned 72 clean images. So the live probe does not show a difference between the build before and after, and what shows that the queue works is the unit tests, which place the second request between the first request's hide and its show and check the order of the messages that the page receives. The cause that the first session described (the overlay is hidden and shown again by each request with nothing serialising them) is in the code and is unchanged by this measurement.

## The size limit (#37, added)

Before this change an image had no size limit: in a window that was enlarged to 2540 by 1400 CSS pixels (the window of this run is 1297 by 1130), a region as large as the viewport came back at 3235 by 1837 pixels and 95 KB, unchanged. On the grid page the bytes are small because the colours are flat; a photograph of the same size would be larger by a factor that was not measured.

The background now reduces an image whose longer side is over 1568 pixels to 1568 pixels on that side, keeping the shape, and returns both sizes. Anthropic's documentation gives 1568 pixels on the longer side as the size above which an image is resized before the model reads it, so a larger image costs upload time and gains nothing; this figure comes from the request for this change and was not read from the documentation again. The same limit is used for every provider. The preview says "The image was reduced from W × H to W × H pixels before it is sent, because providers resize larger images." in both panels that show a screenshot.

### Measurements

| Check | Result |
|---|---|
| Whole viewport, window enlarged (`crop.mjs`) | A capture of 3675 by 1838 pixels came back as 1568 by 784 pixels (46 KB); the reply held both sizes; the shape was kept (2.0000 against 1.9995, from rounding to whole pixels) |
| Control: a small region of the same page (300 by 200 CSS pixels) | 450 by 300 pixels, not reduced |
| Through the sidebar and picker (`probe.mjs`, case `shot-reduced`) | A region of 1680 by 880 CSS pixels at a ratio of 1.5 was 2521 by 1320 pixels before the limit; the image in the panel was 1568 by 821 pixels (58 KB) and the panel said "The image was reduced from 2521 × 1320 to 1568 × 821 pixels before it is sent, because providers resize larger images." |
| Control: every other case of the probe | The preview has no note about a reduced image |
| Unit tests (`src/background/capture.test.ts`, `src/shared/region.test.ts`, `src/sidebar/lib/flow.test.ts`) | A 3000 by 2000 capture is drawn at 1568 by 1045 with smoothing set to high, a tall image is reduced by its height, an image of exactly 1568 pixels is not touched, and the panel clears the note for an image that was not reduced and when the screenshot is dropped |

With the normal window of this run, the capture is at most about 1388 by 1451 pixels, because it cannot be larger than the window in device pixels, so the limit does not apply there. It applies to a larger window or a display with more pixels, and to nothing else.

What was not measured: the image as a model reads it before and after the reduction (a paid call is outside this work); whether a reduced image changes what the model reports for small text; and the limits of providers other than Anthropic. The quality of the reduction was set to the browser's "high" smoothing and was not compared with other settings.

## The paid run with a real model (#37, 2026-11-02)

The runs above end at a stub provider. This one uses the provider of the development profile (Anthropic, `claude-sonnet-5-5` for generation) through the real sidebar and picker, on the extension built from commit 002adab, in Firefox 159.0 with a device pixel ratio of 1.5. It made three calls to the model for this issue. Their tokens and costs are in the table in `test/injection/README.md`, section "Paid run of 2 November 2026".

### Method

- `live.mjs` serves `live-server.mjs`, a page with a section (`#badge`) that holds a 320 by 200 canvas. The canvas draws an orange circle (#e8590c, the largest shape), a small blue square (#1c7ed6) and the word ZEBRA-42. The canvas has no text, alt text or label, so none of this is in the page's markup or text.
- The script clicks "Choose part of the page to change" and then the badge's own padding with trusted input, clicks "Add a screenshot", and drags over the canvas. It types the instruction into the panel's box and clicks Brew. The instruction asks for a 6px solid border and a background in the colour of the largest shape in the picture, and for a caption, in the badge's `::after` content, with the word written in the picture.
- The background's `fetch` is wrapped for the run so that the body of each request to the provider is recorded as sent. Headers are never read, so the credential is not in the record. For each request the script records the content blocks, the image's media type and base64 length, a SHA-256 of the image data, and every text block.
- The control is the same pick and instruction with no screenshot.

### Results

| Check | With the screenshot | Without it (control) |
|---|---|---|
| Requests to the messages endpoint | 1 | 1 |
| Content blocks in the request, in order | `image`, `text` | `text` |
| Images in the request | 1, `image/png`, 24,008 base64 characters | 0 |
| Size of the image | 480 × 300 pixels (the region is 320 × 200 CSS pixels at a ratio of 1.5), under the 1568-pixel limit, so no reduction and no note in the preview | not applicable |
| Image against the preview | Byte-identical: the bytes of the image in the request and of the one the panel showed have the same SHA-256 (674dcd27...fecac) | not applicable |
| The words ZEBRA, orange, blue, e8590c and 1c7ed6 in the request's text or system prompt | None | None |
| Tokens | 5,351 in, 643 out | 5,148 in, 2,638 out |

What the model returned with the screenshot was a CSS transform: a 6px solid border and a background colour of #e85a0c on `#badge`, and `#badge::after` with the content "ZEBRA-42". The colour is one level off in the green channel from the one drawn (#e8590c), and the rationale says it was estimated by eye. The word and the colour appear nowhere in the request except in the image, so the model read them from the image.

What the model returned without the screenshot was a JavaScript transform. It could not know the colour or the word, so it reads the canvas's pixels at run time (`getImageData`), takes the most common colour that is not the corner colour, and takes the caption from the canvas's `aria-label`, which does not exist. Its rationale says that it could not read the word drawn on the canvas. The code would draw no caption on this page.

The calls also show that the live capability lookup happens: a `GET /v1/models/claude-sonnet-5-5` precedes each generation, and the screenshot controls were present in the panel.

### What this does not show

- Only one model and one picture were tried. That the model used the image is shown for this page. It is not a measure of how reliably a model reads small text or fine colour differences.
- A display with a device pixel ratio of exactly 2 at 100 percent zoom, the consent text naming the provider, cross-origin frames inside the region, tab capture (#135) and Firefox for Android are not covered here and remain as listed in the section on what was not verified.

## Clipped regions and the model gate

A region that ends below the viewport (120, 700, 200 × 500 at a ratio of 1.5) is reported as clipped, and the image is 254.7 CSS pixels tall where the region is 500. That image contains 1500 pixels that are not grid colours. They are the page's horizontal scrollbar, which the region reaches, and the probe reports the count without asserting it. A provider whose model does not read images (`supportsVision` false) gets no screenshot controls in the panel.

## What was found

- Two overlapping capture requests could return an image that contains the extension's lock fill (fixed, see the section on overlapping capture requests). In one run the test harness sent every click twice by mistake. Two `capture-region` requests were sent about 2 milliseconds apart, and the page showed the extension's overlay removed at the first request's start and added again before the second request's capture, so the second image was tinted (a 10 percent fill of the accent colour over the whole region). A deliberate double click in a later run sent two requests and returned a clean image, so the race is real in the code and was seen once. `captureWithLockDown` in `src/background/index.ts` hides the layer and shows it again for each request, and nothing serialises two requests.
- A large region at a device pixel ratio of 2 came back 4 device pixels short of 1280. The cause was not a defect of that size alone; see the section on the crop.
- No limit applied to the size of an image (fixed, see the section on the size limit). The largest one in the first run was 1276 × 1356 pixels and 50 KB, which is small because the grid is flat colour.

## What was not verified

- A real provider and a real model, in the runs above. The stub returns an error, so what a model does with the image was untested there; the section on the paid run covers it.
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
WA_RDP_PORT=<port> node test/screenshot/crop.mjs
```

`CASES` takes a comma-separated list of case labels and skips the second and third parts of the run. A full run takes about seven minutes. The exit status is 1 when a row of the verdict fails.

| File | Purpose |
|---|---|
| `probe.mjs` | The run, the controls and the verdict |
| `drive.mjs` | Trusted input, image analysis and the placement of an image on the page, with a fit of the scale from the cell edges |
| `crop.mjs` | The image against the region at five page zooms, with and without scrolling, from the message that the panel sends, and the size limit with an enlarged window |
| `server.mjs` | The grid page, a second page, and the stub provider |
| `live.mjs` | The paid run with a real model (see the section on it); needs a credential in the profile |
| `live-server.mjs` | The page with the badge and its canvas |
