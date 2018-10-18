import { ExecOptions } from "child_process";
import * as glob from "glob";
import * as proc from "child_process";
import * as path from "path";
import * as semver from "semver";
import * as fs from "fs-extra";
import * as substitute from "token-substitute";

require("dotenv").config();

try {
    let manifest = require("../dist/vss-extension.json");
    let extensionId = manifest.id;
    let cacheManifestVersion = manifest.version;
    let newVersion = semver.inc(cacheManifestVersion, "patch");
    manifest.version = newVersion;

    // read all task.json files for version update
    let taskJsons = glob.sync("dist/**/task.json");
    taskJsons.forEach(file => {
        let taskFilePath = path.resolve(__dirname, "../", file);
        let taskFileContent = require(taskFilePath);
        let cacheTaskName = taskFileContent.name;
        let cacheHelpMarkdown = taskFileContent.helpMarkDown;
        taskFileContent.name = `${taskFileContent.name}-dev`;
        let cacheTaskVersion = semver.valid(`${taskFileContent.version["Major"]}.${taskFileContent.version["Minor"]}.${taskFileContent.version["Patch"]}`);
        let newTaskVersion = semver.inc(cacheTaskVersion, "patch");
        let replaceVersion = {
            prefix: "__",
            suffix: "__",
            tokens: {
                "VERSION": newTaskVersion
            }
        };

        let newTaskContent = substitute(taskFileContent, replaceVersion);

        newTaskContent.version["Major"] = semver.major(newTaskVersion);
        newTaskContent.version["Minor"] = semver.minor(newTaskVersion);
        newTaskContent.version["Patch"] = semver.patch(newTaskVersion);

        taskFileContent.version["Major"] = semver.major(newTaskVersion);
        taskFileContent.version["Minor"] = semver.minor(newTaskVersion);
        taskFileContent.version["Patch"] = semver.patch(newTaskVersion);

        console.log(`Updating task.json version to ${newTaskVersion}`);
        fs.writeJsonSync(taskFilePath, newTaskContent, { spaces: "\t" });

        // revert to the old task name
        taskFileContent.name = cacheTaskName;
        taskFileContent.helpMarkDown = cacheHelpMarkdown;
        let parsedPath = taskFilePath.replace("dist\\", "");
        fs.writeJsonSync(parsedPath, taskFileContent, { spaces: "\t" });
    });

    console.log(`Updating version number in manifest file to ${manifest.version}`);
    let destManifest = path.resolve(__dirname, "../dist/vss-extension.json");
    fs.writeJsonSync(destManifest, manifest, { spaces: "\t" });

    let distDir = path.resolve(process.cwd(), "dist");

    console.log("Creating and sharing the package...");
    // Package and share
    let command = `tfx extension publish --manifest-globs vss-extension.json --extension-id ${extensionId}-dev --no-prompt --auth-type PAT --token ${process.env.VSTS_PAT} --share-with ${process.env.VSTS_ACCOUNT}`;

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

        let src = path.join(distDir, "vss-extension.json");
        let dest = path.join(process.cwd(), "vss-extension.json");

        console.log(`Copying extension manifest to source...`);

        fs.copyFileSync(src, dest);
        console.log("Done.");

    });
} catch (error) {
    console.error(error);
}
