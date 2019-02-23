import { ExecOptions } from "child_process";
import * as glob from "glob";
import * as proc from "child_process";
import * as path from "path";
import * as semver from "semver";
import * as fs from "fs-extra";
import * as substitute from "token-substitute";
import * as yargs from "yargs";
import * as chalks from "chalk";
import * as jsonPatch from "fast-json-patch";

let chalk = chalks.default;

let argv = yargs.argv;
let taskids = require("./taskids.json");

require("dotenv").config();

try {
    let manifest = require("../dist/vss-extension.json");
    let extensionId = manifest.id;
    let manifestName = manifest.name.replace(/Dev:/g, "").trim();
    let tempManifestVersion = manifest.version;
    let newVersion = semver.inc(tempManifestVersion, "patch");

    // read all task.json files for version update
    let taskJsons = glob.sync("dist/**/task.json");
    updateTaskJson(taskJsons);

    console.log(`Updating version number in manifest file from ${chalk.magenta(tempManifestVersion)} to ${chalk.blue(newVersion)}`);
    console.log(`Updating extension name from ${chalk.magenta(manifestName)} to ${chalk.blue(`Dev: ${manifestName}`)}`);

    let patchBetaManifest: jsonPatch.Operation[] = [
        { op: "replace", path: "/id", value: `${manifest.id}-dev` },
        { op: "replace", path: "/version", value: newVersion },
        { op: "replace", path: "/name", value: `Dev: ${manifestName}` },
        { op: "replace", path: "/contributions/2/properties/downloadTaskId", value: taskids.betaId },
    ];

    let patchedManifest = jsonPatch.applyPatch(manifest, patchBetaManifest).newDocument;

    let destManifest = path.resolve(__dirname, "../dist/vss-extension.json");
    fs.writeJsonSync(destManifest, patchedManifest, { spaces: "\t" });
    console.log(`${chalk.green("Updated")} vss-extension.json in dist folder`);

    let distDir = path.resolve(process.cwd(), "dist");

    console.log("Creating and sharing the package...");
    // Package and share
    let command = `tfx extension publish --manifest-globs vss-extension.json --no-prompt --auth-type PAT --token ${process.env.VSTS_PAT} --share-with ${process.env.VSTS_ACCOUNT}`;

    proc.exec(command, <ExecOptions>{ cwd: distDir }, (error, stdout, stderr) => {

        if (error) {
            console.error(`Could not create package: '${error}'`);
            return;
        }
        if (stderr) {
            console.error(`Could not create package: '${stderr}'`);
            return;
        }

        console.log(`Extension shared with account...`);

        let removeBetaManifest: jsonPatch.Operation[] = [
            { op: "replace", path: "/id", value: manifest.id.replace(/-dev/g, "").trim() },
            { op: "replace", path: "/version", value: newVersion },
            { op: "replace", path: "/name", value: manifestName },
            { op: "replace", path: "/contributions/2/properties/downloadTaskId", value: taskids.id },
        ];

        let patchedManifest = jsonPatch.applyPatch(manifest, removeBetaManifest).newDocument;

        fs.writeJsonSync(destManifest, patchedManifest, { spaces: "\t" });
        let src = path.join(distDir, "vss-extension.json");
        let dest = path.join(process.cwd(), "vss-extension.json");

        console.log(`Copying extension manifest to source...`);

        fs.copyFileSync(src, dest);
        console.log("Done.");

    });
} catch (error) {
    console.error(error);
}

function updateTaskJson(taskJsons: string[]) {
    taskJsons.forEach(file => {
        let taskFilePath = path.resolve(__dirname, "../", file);
        let taskJson = require(taskFilePath);
        let tempTaskId = taskJson.id;
        let tempHelpMarkdown = taskJson.helpMarkDown;
        let tempFriendlyName = taskJson.friendlyName.replace(/\(beta\)/g, "").trim();
        let tempTaskVersion = semver.valid(`${taskJson.version["Major"]}.${taskJson.version["Minor"]}.${taskJson.version["Patch"]}`);
        let newTaskVersion = semver.inc(tempTaskVersion, "patch");
        let betaTaskPatch: jsonPatch.Operation[] = [
            { op: "replace", path: "/version/Major", value: semver.major(newTaskVersion) },
            { op: "replace", path: "/version/Minor", value: semver.minor(newTaskVersion) },
            { op: "replace", path: "/version/Patch", value: semver.patch(newTaskVersion) },
            { op: "replace", path: "/helpMarkDown", value: newTaskVersion },
        ];
        if (argv.beta) {
            console.log(chalk.yellow("Applying task id for BETA testing"));
            betaTaskPatch.push({ op: "replace", path: "/id", value: taskids.betaId }, { op: "replace", path: "/friendlyName", value: tempFriendlyName + " (beta)" });
        }
        else {
            console.log(chalk.yellow("Applying task id for PROD"));
            betaTaskPatch.push({ op: "replace", path: "/id", value: taskids.id }, { op: "replace", path: "/friendlyName", value: tempFriendlyName });
        }
        let patchedJson = jsonPatch.applyPatch(taskJson, betaTaskPatch).newDocument;
        console.log(`Changed task id from ${chalk.magenta(tempTaskId)} to ${chalk.blue(patchedJson.id)}`);
        console.log(`Changed friendlyName from ${chalk.magenta(tempFriendlyName)} to ${chalk.blue(patchedJson.friendlyName)}`);
        console.log(`Updating task.json version to ${newTaskVersion}`);
        fs.writeJsonSync(taskFilePath, patchedJson, { spaces: "\t" });
        console.log("Updated task.json in dist folder");
        // revert to the old task name
        patchedJson.id = taskids.id;
        patchedJson.name = tempFriendlyName;
        patchedJson.helpMarkDown = tempHelpMarkdown;
        patchedJson.friendlyName = tempFriendlyName;
        let parsedPath = taskFilePath.replace("dist\\", "");
        fs.writeJsonSync(parsedPath, patchedJson, { spaces: "\t" });
        console.log(`${chalk.green("Updated")} task.json in actual task (non dist) folder`);
    });
}
