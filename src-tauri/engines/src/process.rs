// SPDX-License-Identifier: MIT
//! Running the external tools (FFmpeg, ExifTool, LibreOffice): arguments as an array, no console
//! window on Windows, and a kill that also ends whatever the program started.

use std::io;
use std::path::Path;
use std::process::{Child, Command, Stdio};

/// A command for the tools, set up the same way every time.
pub(crate) fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: the tools are console programs, and every run would flash a window.
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Kills the process unless it has ended, so that no early return leaves a tool running.
///
/// On Windows the process runs in a job object, and the kill ends everything in it: package
/// manager shims, launchers and LibreOffice's `soffice` all start the real program as a child.
/// On Unix a process started with `spawn_group` leads its own process group, which the kill ends
/// as a whole.
pub(crate) struct Reap {
    pub(crate) child: Child,
    #[cfg(windows)]
    tree: Option<tree::Tree>,
    #[cfg(unix)]
    group: bool,
}

impl Reap {
    /// Takes care of a process that is already running.
    pub(crate) fn new(child: Child) -> Reap {
        Reap {
            #[cfg(windows)]
            tree: tree::Tree::new(&child),
            child,
            #[cfg(unix)]
            group: false,
        }
    }

    pub(crate) fn spawn(mut command: Command) -> io::Result<Reap> {
        Ok(Reap::new(command.spawn()?))
    }

    pub(crate) fn kill(&mut self) {
        #[cfg(windows)]
        if let Some(tree) = &self.tree {
            tree.kill();
        }
        #[cfg(unix)]
        if self.group {
            if let Ok(id) = libc::pid_t::try_from(self.child.id()) {
                // SAFETY: a plain signal to the group this process leads; it has not been reaped
                // yet (`wait` comes below), so the group id still belongs to it.
                unsafe {
                    libc::kill(-id, libc::SIGKILL);
                }
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Reap {
    fn drop(&mut self) {
        if let Ok(None) = self.child.try_wait() {
            self.kill();
        }
    }
}

#[cfg(windows)]
mod tree {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// A job object holding one tool's process and anything it starts. Closing it ends them all,
    /// so a run can never outlive Kento either.
    pub struct Tree(HANDLE);

    // The handle is only used to end the processes; the job object itself is thread-safe.
    unsafe impl Send for Tree {}

    impl Tree {
        /// None when the process cannot be put in a job; the kill then reaches only the process.
        pub fn new(child: &Child) -> Option<Tree> {
            // SAFETY: plain Win32 calls on a handle this function owns, with a correctly sized
            // structure; the child's handle stays valid while `child` lives.
            unsafe {
                let job = Tree(CreateJobObjectW(None, PCWSTR::null()).ok()?);
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .ok()?;
                AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())).ok()?;
                Some(job)
            }
        }

        pub fn kill(&self) {
            // SAFETY: the handle is open until drop.
            unsafe {
                let _ = TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            // SAFETY: closed once, here.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}
