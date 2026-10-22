# Local test assets — NOT deployed

`celebration-applause.mp3` is the recovered V62 applause (9.43 s, unmodified). Its source and reuse rights are
**unverified**, so it lives here, outside `public/`, and is never served by a deployment of this package.

To test it locally ONLY:
1. `cp local-test-assets/celebration-applause.mp3 public/audio/celebration-applause.mp3`
2. run with `NEXT_PUBLIC_PRESENTATION_APPLAUSE=on`
3. delete the copy from `public/audio/` before building anything that will be deployed
   (an automated test fails if the file is present in `public/audio/`).

Production: leave the flag unset/off until rights are verified or a licensed replacement is supplied.
