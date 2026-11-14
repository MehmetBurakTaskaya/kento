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

; Waits until no program uses the installed kento.exe, for up to 30 seconds, closing the ones that
; can be closed as Tauri's check after this hook does. That check gives up at once on a program it
; cannot close, and an update starts while the Kento that started it is still ending, which
; cannot be closed until it has; a virus scanner reading the file is another. Uses $0 to $4 and
; $R7, $R8.
!macro KentoWaitForApp
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $R7
  Push $R8
  System::Call 'kernel32::GetTickCount() i .R8'
  ${Do}
    StrCpy $0 1
    !insertmacro RestartManager_StartSession $R7
    ${If} $R7 != ""
      !insertmacro RestartManager_RegisterFile $R7 "$INSTDIR\${MAINBINARYNAME}.exe"
      ${If} $0 = 0
        System::Call 'RSTRTMGR::RmGetList(i R7, *i .r1, *i .r2, p 0, *i .r3) i .r0'
        ; ERROR_MORE_DATA: some program uses it.
        ${If} $0 = 234
          System::Call 'RSTRTMGR::RmShutdown(i R7, i ${RmForceShutdown}, p 0) i .r4'
        ${EndIf}
      ${EndIf}
      !insertmacro RestartManager_EndSession $R7
    ${EndIf}
    System::Call 'kernel32::GetTickCount() i .r1'
    IntOp $1 $1 - $R8
    ${If} $0 <> 234
    ${OrIf} $1 >= 30000
      ${ExitDo}
    ${EndIf}
    Sleep 250
  ${Loop}
  Pop $R8
  Pop $R7
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; An install that failed puts back the command line the hook below set aside (the next install
; would delete it). A quiet one, an update's, then starts the Kento that is still there again when
; it was asked to start Kento (/R), so the user is never left without it; that Kento sees that the
; update did not happen and does not try it again by itself. Tauri reads this file before it
; defines the program's name, its own variables and its plugin, hence the names written out and
; Exec, which runs Kento as the user this per-user installer runs as.
Function .onInstFailed
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
  !insertmacro KentoWaitForApp
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
