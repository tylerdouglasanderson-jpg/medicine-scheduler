// The ONLY module that mentions the ?url specifier — Node/Vitest never imports this file,
// so the `highs/runtime?url` specifier is never seen outside the Vite browser build.
import highsLoader from 'highs';
import wasmUrl from 'highs/runtime?url';

export default () => highsLoader({ locateFile: () => wasmUrl });
