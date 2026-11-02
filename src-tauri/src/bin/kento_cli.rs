// SPDX-License-Identifier: MIT
//! `kento` in a terminal (SPEC 5.2). A console program of its own beside the app, which is a GUI
//! program on Windows: a terminal waits for this one, shows its output and gets its exit code.
//! It never starts the window, the tray or the single-instance hand-off.

fn main() -> std::process::ExitCode {
    kento_lib::cli::main()
}
