import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export async function pickWorkspaceFolder({ platform = process.platform, timeout = 120000 } = {}) {
  const picker = folderPickerCommand(platform);
  if (!picker) {
    return {
      ok: false,
      error: "No native folder picker is available on this system. Enter the absolute workspace path manually."
    };
  }

  return new Promise((resolvePick) => {
    execFile(picker.command, picker.args, { timeout }, (error, stdout, stderr) => {
      const path = String(stdout || "").trim();
      if (!error && path) {
        resolvePick({ ok: true, path });
        return;
      }
      if (error && !path && (error.code === 1 || error.signal === "SIGTERM")) {
        resolvePick({ ok: true, cancelled: true });
        return;
      }
      resolvePick({ ok: false, error: String(stderr || error?.message || "Folder picker failed").trim() });
    });
  });
}

export function folderPickerCommand(platform = process.platform, hasCommand = commandOnPath) {
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", 'POSIX path of (choose folder with prompt "Select a Codex workspace")']
    };
  }

  if (platform === "win32") {
    return {
      command: "powershell",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        [
          "Add-Type -AssemblyName System.Windows.Forms",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          '$dialog.Description = "Select a Codex workspace"',
          "$dialog.ShowNewFolderButton = $false",
          "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }"
        ].join("; ")
      ]
    };
  }

  if (platform === "linux") {
    if (hasCommand("zenity")) {
      return {
        command: "zenity",
        args: ["--file-selection", "--directory", "--title=Select a Codex workspace"]
      };
    }
    if (hasCommand("kdialog")) {
      return {
        command: "kdialog",
        args: ["--getexistingdirectory", ".", "Select a Codex workspace"]
      };
    }
  }

  return null;
}

function commandOnPath(command) {
  return String(process.env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => existsSync(join(dir, command)));
}
