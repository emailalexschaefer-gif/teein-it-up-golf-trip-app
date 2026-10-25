# Local test assets — NOT deployed

The recovered V62 applause clip (9.43 s) has **unverified** source and reuse rights, so it is deliberately NOT included in this package or repository. If you hold your own copy for local testing only, it must never be committed.

To test it locally ONLY:
1. copy your local copy to `public/audio/celebration-applause.mp3`
2. run with `NEXT_PUBLIC_PRESENTATION_APPLAUSE=on`
3. delete the copy from `public/audio/` before building anything that will be deployed
   (an automated test fails if the file is present in `public/audio/`).

Production: leave the flag unset/off until rights are verified or a licensed replacement is supplied.
