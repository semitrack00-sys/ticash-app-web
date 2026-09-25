# FlupFlap production hero artwork

The approved user-supplied artwork is installed at `brand/flupflap/flupflap-woman-worldwide-hero.png`. The original 1586 × 992 transparent PNG is copied without pixel edits or recompression.

SHA-256: `FC07283BF37FE2CD01DCAF33CDAE569E804539BE9AC0935F04C3D02B9AD66FE5`.

## Integration

The existing `.flupflap-hero-art` decorative slot displays the asset at desktop widths of 1024px and above. It uses proportional scaling and right alignment in only the remaining space to the right of the approved logo/text/feature area. The 140% background width compensates for the supplied image’s transparent left margin; a 520px width cap keeps the full visible artwork inside the existing hero height. On smaller desktops the image scales down to preserve the face, phone, globe, and surrounding details. No mask fades out the important artwork. The original gradients remain underneath. The slot is excluded from accessibility semantics and pointer interaction; no image box, missing-image icon, or extra layout height is introduced.

Below 1024px the artwork is hidden and the approved gradient-only hero remains unchanged. There is not enough unused space in the approved narrow layout to show this composition without crowding the logo, text, or icons. No mobile crop or redesign is introduced.

The flags in the supplied artwork are decorative. Available destinations continue to come only from backend coverage. No provider, payment, quote, authentication, or localization behavior is changed by the image.

## Coverage and fixture isolation

`Available destinations` renders `Recharge.state.countries`, loaded and validated from the existing `/mobile-topups/countries` backend endpoint. It has no fallback destination list and is hidden when the list is empty. Country translations and flag files are presentation assets, not evidence of coverage.

The Jamaica/Canada/Haiti/France list, test operator, test airtime, test phone, and test prices used in screenshots live in `tools/fixtures.mjs` and test files. A local, uncommitted loopback-only preview script (`tools/flupflap-visual-preview.mjs`) was used to import these fixtures and inject a fake API solely into an isolated screenshot preview. This script and the separate login preview script are local development artifacts, excluded from the production commit and not required to build, test, or run the application. Application modules do not import it, no URL parameter activates fixtures, and its browser CSP blocks API connections and payment frames. Its simulated quote route does not make a provider request; payment/recharge submissions are rejected.

The existing static publication configuration publishes the repository root, so test source files may be downloadable as static files. They are not imported or executed as production data sources; the preview server requires an explicit local Node invocation. Publication configuration is unchanged by this UI verification.
