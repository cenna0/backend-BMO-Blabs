import { main } from "./acceptance-worker.js";

process.exitCode = await main();
