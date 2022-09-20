`node index.mjs`

Will print something like:

``` bash
wait started
wait completed
wait started
#
```

Where the last wait never wakes. See, https://github.com/ronag/waitAsync-wake-repro/blob/main/shared.mjs#L168-L173.
