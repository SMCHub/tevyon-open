#!/usr/bin/env node
import { realIo } from "../src/io.ts";
import { main } from "../src/main.ts";

process.exitCode = await main(realIo());
