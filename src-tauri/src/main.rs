// SPDX-License-Identifier: MIT
// No console window behind Kento in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kento_lib::run()
}
