//! Node-toolchain launch helpers (`node`, `npm`, `npx`), cross-platform.

use std::process::Command;

/// Whether `program` is a Node-toolchain launcher that needs the Windows shim
/// path. `npm`/`npx` are `.cmd` batch shims on Windows that `std::process`
/// cannot resolve directly (it appends `.exe` and ignores PATHEXT); `node`
/// resolves to `node.exe` but is routed the same way for uniformity.
pub fn is_node_tool(program: &str) -> bool {
    matches!(program, "node" | "npm" | "npx")
}

/// Build a spawnable [`Command`] for a Node-toolchain program, cross-platform.
/// On Windows a Node launcher goes through `cmd /C <program> <args…>` so the
/// `.cmd` shim resolves; everywhere else the program is spawned directly.
///
/// Windows caveat: `cmd.exe` re-parses the argument line, so a value with
/// embedded newlines / shell metacharacters (the generated PEM passed to
/// `convex env set`) may need extra quoting there — a Windows-path detail to
/// verify on a real Win box (unix, the primary target, is unaffected).
pub fn node_command(program: &str, args: &[&str]) -> Command {
    if cfg!(windows) && is_node_tool(program) {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(program).args(args);
        cmd
    } else {
        let mut cmd = Command::new(program);
        cmd.args(args);
        cmd
    }
}

/// Like `ados_term::exec::run_ok` but for a Node-toolchain program (uses [`node_command`] so it
/// works on Windows). Best-effort presence probe.
pub fn node_run_ok(program: &str, args: &[&str]) -> bool {
    ados_term::exec::run_cmd(node_command(program, args)).success()
}
