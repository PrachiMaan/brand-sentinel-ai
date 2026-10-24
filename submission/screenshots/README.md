# Screenshots not captured

The submission asks for Playwright screenshots of the deployed app. They could not
be captured in this environment:

- the Playwright Chromium build needs system libraries (`libglib-2.0.so.0`,
  `libX11` and others) that are not installed in the sandbox;
- `playwright install-deps` failed with `No space left on device` (the disk was
  98% full), so the libraries could not be added.

No images were staged or reused from another source. `SUBMISSION.pdf` section 08
lists the nine captures still to take, with the route and the content each must
show. `DEMO_SCRIPT.md` is the path a judge can follow to reproduce them.
