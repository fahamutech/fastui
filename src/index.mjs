#! /usr/bin/env node

import {processCommand} from "./cli/command.mjs";

const {argv} = process;

const command1 = argv[2];
const specsCommand = argv[3];

processCommand(command1, specsCommand, process.argv).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
