; SPDX-License-Identifier: MIT
; Additions to Tauri's NSIS installer and uninstaller (docs/RELEASING.md). Kento installs per user
; into %LOCALAPPDATA%\Kento, the folder that also holds its data, so the uninstaller removes
; program files one by one and the data only when the user asks for it.

!include LogicLib.nsh

; The key under HKCU that holds the user's environment variables.
!define /ifndef KENTO_ENVIRONMENT "Environment"

; Opening the installer installs at once: it starts itself again in Tauri's passive mode (/P),
; which shows only the progress bar, closes a running Kento and starts Kento when it is done (/R).
; Silent installs never reach this point, and the updater installs silently.
!define MUI_CUSTOMFUNCTION_GUIINIT KentoOneClick
Function KentoOneClick
  ; Installing the version that is already there runs its uninstaller first. The uninstaller
  ; inherits this variable and then keeps what Kento registered, as it does during an update.
  System::Call 'kernel32::SetEnvironmentVariableW(w "KENTO_REINSTALL", w "1")'
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $R0
  ${If} ${Errors}
    ${GetParameters} $R0
    Exec '"$EXEPATH" /P /R $R0'
    Quit
  ${EndIf}
FunctionEnd

; Finds the install folder as a whole entry of the Path in the buffer at $5 (case does not
; matter), $4 being the folder name's length in bytes. Leaves the entry's address in $6, or 0.
; Uses $0, $7, $8 and $9.
!macro KentoPathFind
  StrCpy $6 0
  StrCpy $7 $5
  ${Do}
    System::Call 'shlwapi::StrStrIW(p r7, w "$INSTDIR") p .r8'
    ${If} $8 P= 0
      ${ExitDo}
    ${EndIf}
    ; The characters around it must be separators, or the start and the end of the value.
    StrCpy $9 59
    ${If} $8 P<> $5
      IntPtrOp $0 $8 - 2
      System::Call '*$0(&i2 .r9)'
    ${EndIf}
    IntPtrOp $0 $8 + $4
    System::Call '*$0(&i2 .r0)'
    ${If} $0 = 0
      StrCpy $0 59
    ${EndIf}
    ${If} $9 = 59
    ${AndIf} $0 = 59
      StrCpy $6 $8
      ${ExitDo}
    ${EndIf}
    IntPtrOp $7 $8 + 2
  ${Loop}
!macroend

; ADD puts the install folder at the end of the user's Path unless it is already there; REMOVE
; takes out exactly that entry. Terminals opened afterwards then find kento.com. The value is
; edited in memory of its own: NSIS strings stop at ${NSIS_MAX_STRLEN} characters, and a longer
; Path read through them would be written back cut short. Its type (REG_EXPAND_SZ or REG_SZ) and
; every other entry stay as they were.
!macro KentoPath MODE
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R9
  StrCpy $R9 0
  ; A folder name with the separator in it cannot be an entry.
  System::Call 'shlwapi::StrChrW(w "$INSTDIR", i 59) p .r0'
  ${If} $0 P= 0
    ; KEY_QUERY_VALUE | KEY_SET_VALUE
    System::Call 'advapi32::RegCreateKeyExW(p 0x80000001, w "${KENTO_ENVIRONMENT}", i 0, p 0, i 0, i 3, p 0, *p .r1, p 0) i .r0'
    ${If} $0 = 0
      StrCpy $3 0
      System::Call 'advapi32::RegQueryValueExW(p r1, w "Path", p 0, *i .r2, p 0, *i r3r3) i .r0'
      ; ERROR_FILE_NOT_FOUND: no Path yet, so a new REG_EXPAND_SZ one.
      ${If} $0 = 2
        StrCpy $0 0
        StrCpy $2 2
        StrCpy $3 0
      ${EndIf}
      ${If} $0 = 0
      ${AndIf} $2 >= 1
      ${AndIf} $2 <= 2
        StrLen $4 $INSTDIR
        IntOp $4 $4 * 2
        ; Room for the value, a separator, the folder and two closing NULs; it starts zeroed.
        IntOp $5 $3 + $4
        IntOp $5 $5 + 8
        System::Alloc $5
        Pop $5
        ${If} $3 > 0
          System::Call 'advapi32::RegQueryValueExW(p r1, w "Path", p 0, p 0, p r5, *i r3r3) i .r0'
        ${EndIf}
        ${If} $0 = 0
          !insertmacro KentoPathFind
          !if "${MODE}" == "ADD"
            ${If} $6 P= 0
              System::Call 'kernel32::lstrlenW(p r5) i .r7'
              ${If} $7 > 0
                IntOp $8 $7 - 1
                IntOp $8 $8 * 2
                IntPtrOp $8 $5 + $8
                System::Call '*$8(&i2 .r9)'
                ${If} $9 <> 59
                  System::Call 'kernel32::lstrcatW(p r5, w ";")'
                ${EndIf}
              ${EndIf}
              System::Call 'kernel32::lstrcatW(p r5, w "$INSTDIR")'
              StrCpy $R9 1
            ${EndIf}
          !else
            ${DoWhile} $6 P<> 0
              ; The entry goes with one separator: the one after it, else the one before.
              IntPtrOp $7 $6 + $4
              System::Call '*$7(&i2 .r9)'
              ${If} $9 = 59
                IntPtrOp $7 $7 + 2
              ${ElseIf} $6 P<> $5
                IntPtrOp $6 $6 - 2
              ${EndIf}
              System::Call 'kernel32::lstrlenW(p r7) i .r8'
              IntOp $8 $8 + 1
              IntOp $8 $8 * 2
              System::Call 'kernel32::RtlMoveMemory(p r6, p r7, i r8)'
              StrCpy $R9 1
              !insertmacro KentoPathFind
            ${Loop}
          !endif
          ${If} $R9 = 1
            System::Call 'kernel32::lstrlenW(p r5) i .r7'
            IntOp $7 $7 + 1
            IntOp $7 $7 * 2
            System::Call 'advapi32::RegSetValueExW(p r1, w "Path", i 0, i r2, p r5, i r7) i .r0'
            ${IfThen} $0 <> 0 ${|} StrCpy $R9 0 ${|}
          ${EndIf}
        ${EndIf}
        System::Free $5
      ${EndIf}
      System::Call 'advapi32::RegCloseKey(p r1)'
    ${EndIf}
  ${EndIf}
  ; WM_SETTINGCHANGE to every window, skipping hung ones (SMTO_ABORTIFHUNG).
  ${If} $R9 = 1
    System::Call 'user32::SendMessageTimeoutW(p 0xFFFF, i 0x1A, p 0, w "Environment", i 2, i 5000, *p .r0)'
  ${EndIf}
  Pop $R9
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; The name the installed kento.exe was set aside under during this install, or empty.
Var KentoAppAside
; Why the check whether Kento runs stops the install or uninstall, or empty.
Var KentoStop

; The size of PROCESSENTRY32W in this 32-bit installer.
!define KENTO_PROCESS_ENTRY 556

; Counts in $R9 the copies of Kento running from PATH, the installed kento.exe, never a copy
; elsewhere. With KILL 1 it ends them. Notes each one in the log ($R5, when open) with the time
; ($R7). Uses $0 to $8.
!macro KentoFindApp PATH KILL
  StrCpy $R9 0
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p .r1'
  ${If} $1 P<> -1
    System::Alloc ${KENTO_PROCESS_ENTRY}
    Pop $2
    System::Call '*$2(i ${KENTO_PROCESS_ENTRY})'
    System::Call 'kernel32::Process32FirstW(p r1, p r2) i .r3'
    ${DoWhile} $3 <> 0
      System::Call '*$2(i, i, i .r4, i, i, i, i, i, i, &w260 .r5)'
      ${If} $5 == "${MAINBINARYNAME}.exe"
        ; PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE
        System::Call 'kernel32::OpenProcess(i 0x00101001, i 0, i r4) p .r6'
        ${If} $6 P<> 0
          StrCpy $7 ""
          System::Call 'kernel32::QueryFullProcessImageNameW(p r6, i 0, w .r7, *i ${NSIS_MAX_STRLEN})'
          ; WAIT_TIMEOUT: it has not ended.
          System::Call 'kernel32::WaitForSingleObject(p r6, i 0) i .r8'
          ${If} $7 == "${PATH}"
          ${AndIf} $8 = 258
            IntOp $R9 $R9 + 1
            ${If} ${KILL} = 1
              System::Call 'kernel32::TerminateProcess(p r6, i 1)'
            ${EndIf}
            ${If} $R5 != ""
              FileWrite $R5 "$R7 ms: Kento $4 is running$\r$\n"
            ${EndIf}
          ${EndIf}
          System::Call 'kernel32::CloseHandle(p r6)'
        ${EndIf}
      ${EndIf}
      System::Call 'kernel32::Process32NextW(p r1, p r2) i .r3'
    ${Loop}
    System::Free $2
    System::Call 'kernel32::CloseHandle(p r1)'
  ${EndIf}
!macroend

; Frees the installed kento.exe for the new one, and sets it aside so that Tauri's check after this
; hook, which asks Restart Manager about kento.exe and gives up at once on a program it cannot
; close, finds nothing to ask about. Restart Manager cannot be relied on here: on a computer with a
; virus scanner it took minutes to answer and named the scanner's service, which never ends
; (1.2.2 to 1.2.3), and before that it named a Kento that had ended (1.2.1 to 1.2.2). So the hook
; looks for the copies of Kento running from this folder itself: the one that started an update
; ends at once, and one still running after 5 seconds (at once outside an update) is ended. Then
; kento.exe is renamed to kento-app.<n>.old, which Windows allows for a program in use but not while
; a scanner holds it without sharing, so it tries again for up to 30 seconds. What it found goes to
; logs\installer.log, for when an install does not go through. Uses $0 to $8 and $R4 to $R9.
!macro KentoFreeApp
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $KentoAppAside ""
  CreateDirectory "$INSTDIR\logs"
  ClearErrors
  FileOpen $R5 "$INSTDIR\logs\installer.log" w
  ${If} ${Errors}
    StrCpy $R5 ""
  ${EndIf}
  ${If} $R5 != ""
    FileWrite $R5 "Kento ${VERSION} installer: $CMDLINE$\r$\n"
  ${EndIf}
  StrCpy $R6 0
  ${If} $UpdateMode = 1
    StrCpy $R6 5000
  ${EndIf}
  System::Call 'kernel32::GetTickCount() i .R8'
  ${Do}
    System::Call 'kernel32::GetTickCount() i .r0'
    IntOp $R7 $0 - $R8
    ${If} $R7 < $R6
      !insertmacro KentoFindApp "$INSTDIR\${MAINBINARYNAME}.exe" 0
    ${Else}
      !insertmacro KentoFindApp "$INSTDIR\${MAINBINARYNAME}.exe" 1
    ${EndIf}
    ${If} $R9 = 0
    ${OrIf} $R7 >= 30000
      ${ExitDo}
    ${EndIf}
    Sleep 200
  ${Loop}
  ; A copy left by an earlier install whose Kento had not ended goes now.
  Delete "$INSTDIR\kento-app.*.old"
  StrCpy $R4 0
  StrCpy $2 0
  ${If} $R9 = 0
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    System::Call 'kernel32::GetTickCount() i .r0'
    StrCpy $R6 "kento-app.$0.old"
    ${Do}
      IntOp $R4 $R4 + 1
      System::Call 'kernel32::MoveFileW(w "$INSTDIR\${MAINBINARYNAME}.exe", w "$INSTDIR\$R6") i .r1 ?e'
      Pop $2
      ${If} $1 <> 0
        StrCpy $KentoAppAside $R6
        StrCpy $2 0
        ${ExitDo}
      ${EndIf}
      System::Call 'kernel32::GetTickCount() i .r1'
      IntOp $1 $1 - $0
      ${If} $1 >= 30000
        ${ExitDo}
      ${EndIf}
      Sleep 250
    ${Loop}
  ${EndIf}
  ${If} $R5 != ""
    System::Call 'kernel32::GetTickCount() i .r0'
    IntOp $0 $0 - $R8
    FileWrite $R5 "$0 ms: Kento running: $R9; kento.exe set aside as [$KentoAppAside] after $R4 tries (last error $2)$\r$\n"
    FileClose $R5
  ${EndIf}
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; Tauri's own check whether Kento runs, before the files are copied and before they are removed,
; asks Restart Manager too, which can take minutes on a computer with a virus scanner even for a
; kento.exe that has been set aside. Tauri defines it before this file is read, so it is replaced
; here by the same check on the running copies of Kento, with Tauri's messages: a quiet or passive
; install or uninstall ends them, any other asks first; one that has not ended 10 seconds later
; stops it.
!ifmacrodef CheckIfAppIsRunning
  !macroundef CheckIfAppIsRunning
!endif
!macro CheckIfAppIsRunning executablePath productName
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R5 ""
  StrCpy $R7 0
  !insertmacro KentoFindApp "${executablePath}" 0
  StrCpy $R8 ""
  ${If} $R9 > 0
    ${IfNot} ${Silent}
    ${AndIf} $PassiveMode <> 1
      nsis_tauri_utils::StrReplace "$(appRunningOkKill)" "{{product_name}}" "${productName}"
      Pop $0
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "$0" IDOK +2
      StrCpy $R8 "appRunning"
    ${EndIf}
    ${If} $R8 == ""
      System::Call 'kernel32::GetTickCount() i .R6'
      ${Do}
        !insertmacro KentoFindApp "${executablePath}" 1
        System::Call 'kernel32::GetTickCount() i .r0'
        IntOp $0 $0 - $R6
        ${If} $R9 = 0
        ${OrIf} $0 >= 10000
          ${ExitDo}
        ${EndIf}
        Sleep 200
      ${Loop}
      ${If} $R9 > 0
        StrCpy $R8 "failedToKillApp"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  StrCpy $KentoStop ""
  ${If} $R8 == "appRunning"
    nsis_tauri_utils::StrReplace "$(appRunning)" "{{product_name}}" "${productName}"
    Pop $KentoStop
  ${ElseIf} $R8 == "failedToKillApp"
    nsis_tauri_utils::StrReplace "$(failedToKillApp)" "{{product_name}}" "${productName}"
    Pop $KentoStop
  ${EndIf}
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  ${If} $KentoStop != ""
    Abort $KentoStop
  ${EndIf}
!macroend

; An install that failed puts back kento.exe and the command line the hooks below set aside (the
; next install would delete them). A quiet one, an update's, then starts the Kento that is still
; there again when it was asked to start Kento (/R), so the user is never left without it; that
; Kento sees that the update did not happen and does not try it again by itself. Tauri reads this
; file before it defines the program's name, its own variables and its plugin, hence the names
; written out and Exec, which runs Kento as the user this per-user installer runs as.
Function .onInstFailed
  ${IfNot} ${FileExists} "$INSTDIR\kento.exe"
  ${AndIf} $KentoAppAside != ""
    Rename "$INSTDIR\$KentoAppAside" "$INSTDIR\kento.exe"
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\kento.com"
    FindFirst $R1 $R2 "$INSTDIR\kento-cli.*.old"
    ${If} $R2 != ""
      Rename "$INSTDIR\$R2" "$INSTDIR\kento.com"
    ${EndIf}
    FindClose $R1
  ${EndIf}
  ${If} ${Silent}
    ClearErrors
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
    ${AndIf} ${FileExists} "$INSTDIR\kento.exe"
      ${GetOptions} $CMDLINE "/ARGS" $R0
      Exec '"$INSTDIR\kento.exe" $R0'
    ${EndIf}
  ${EndIf}
FunctionEnd

; The command line ships as kento.com beside kento.exe (SPEC 5.2): Windows tries .com before .exe,
; so `kento` in a terminal runs the console program. Tauri packs it under Cargo's name,
; kento-cli.exe, which takes its place after the files are copied.
!macro NSIS_HOOK_PREINSTALL
  !insertmacro KentoFreeApp
  ; A command line still running from a script holds kento.com: Windows lets it be renamed but not
  ; replaced, so it is set aside and goes once it has ended (here, or at the next install).
  Delete "$INSTDIR\kento-cli.*.old"
  ${If} ${FileExists} "$INSTDIR\kento.com"
    Push $0
    System::Call 'kernel32::GetTickCount() i .r0'
    Rename "$INSTDIR\kento.com" "$INSTDIR\kento-cli.$0.old"
    Pop $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\kento-cli.exe"
    Delete "$INSTDIR\kento.com"
    Rename "$INSTDIR\kento-cli.exe" "$INSTDIR\kento.com"
  ${EndIf}
  Delete "$INSTDIR\kento-cli.*.old"
  Delete "$INSTDIR\kento-app.*.old"
  ; Updates keep the Path as the user left it.
  ${If} $UpdateMode <> 1
    !insertmacro KentoPath ADD
  ${EndIf}
!macroend

; Removes one of Kento's Explorer context menu verbs when its command starts this copy, whose
; quoted path is in $R1 and its length in $R2.
!macro KentoRemoveVerb KEY
  ReadRegStr $R5 HKCU "${KEY}\command" ""
  StrCpy $R5 $R5 $R2
  ${If} $R5 == $R1
    DeleteRegKey HKCU "${KEY}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\kento.com"
  Delete "$INSTDIR\kento-cli.*.old"
  Delete "$INSTDIR\kento-app.*.old"
  ; Tauri removed the folder while kento.com was still in it.
  RMDir "$INSTDIR"
  ReadEnvStr $R0 KENTO_REINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} $R0 != "1"
    ; What Kento registered itself, and only where it points at this copy: Start at sign-in (Tauri
    ; removes its Run value), the Explorer context menu entries and the Send To shortcut.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
    StrCpy $R1 '"$INSTDIR\${MAINBINARYNAME}.exe"'
    StrLen $R2 $R1
    !insertmacro KentoRemoveVerb "Software\Classes\*\shell\Kento"
    !insertmacro KentoRemoveVerb "Software\Classes\Directory\shell\Kento"
    !insertmacro IsShortcutTarget "$SENDTO\Kento.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $R1
    ${If} $R1 = 1
      Delete "$SENDTO\Kento.lnk"
    ${EndIf}
    !insertmacro KentoPath REMOVE
    ; Kento's data, the downloaded tools among it, lives outside the identifier folders Tauri
    ; removes, and goes only when the user ticks "Delete the application data".
    ${If} $DeleteAppDataCheckboxState = 1
      SetShellVarContext current
      RMDir /r "$LOCALAPPDATA\Kento"
    ${EndIf}
  ${EndIf}
!macroend
