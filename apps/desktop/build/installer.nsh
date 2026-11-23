; dancedance.studio Sync's additions to electron-builder's NSIS installer (electron-builder.yml, nsis.include).
;
; - It installs for the current user only: no admin rights, no UAC prompt, no "for all users" choice.
; - Before installing, the page "What Sync sends" sums up docs/privacy.md and asks two questions, both ticked:
;   "Check for new versions automatically" and "Start Sync when Windows starts". A silent install (/S) keeps both on.
;   An update shows nothing and keeps the player's own choices.
; - The answers go into installer-choices.json next to the app, for example
;     {"installId":"{5F1C...}","isAutomaticUpdateCheckOn":true,"shouldStartWithWindows":false}
;   Sync reads it on its first start after an install (src/main/installer-choices.ts), copies the answers into its
;   settings, and from then on its Options switches own them. installId tells one install from the next.
; - It registers the dancedance-sync:// link scheme; the uninstaller removes it and Sync's start-with-Windows value.
;
; Keep it ASCII: these words are shown as they are.

!include nsDialogs.nsh
!include LogicLib.nsh

!define PRIVACY_PAGE_URL "https://github.com/dancedance-studio/sync/blob/main/docs/privacy.md"
; The value Sync writes under the per-user Run key; keep it in step with INSTALLED_LOGIN_ITEM_NAME in
; src/main/start-with-windows.ts.
!define START_WITH_WINDOWS_VALUE_NAME "dancedance.studio Sync"

; Skips electron-builder's "Anyone who uses this computer / Only for me" page: always only for this user.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
  Var checkForUpdatesCheckbox
  Var startWithWindowsCheckbox
  ; "0" once the player unticks the box; empty (on) when the page never showed, as in a silent install.
  Var checkForUpdatesChoice
  Var startWithWindowsChoice
!endif

!macro customPageAfterChangeDir
  Page custom WhatSyncSendsPageShow WhatSyncSendsPageLeave

  Function WhatSyncSendsPageShow
    ${if} ${isUpdated}
      Abort
    ${endIf}
    !insertmacro MUI_HEADER_TEXT "What Sync sends" "No tracking, no ads and no crash reports."
    nsDialogs::Create 1018
    Pop $0
    ${if} $0 == error
      Abort
    ${endIf}

    ; The page is 300 x 140 dialog units: 11 lines of text, the link, then the two boxes.
    ${NSD_CreateLabel} 0 0 100% 88u "Sync sends something only to these places:$\r$\n$\r$\n- dancedance.studio, once you link this computer: your library list, how each sync went and the songs you make.$\r$\n- Addons and generators you add: the facts of each song, and the music you give a generator.$\r$\n- GitHub, to check for new versions: your internet address and the Sync version.$\r$\n$\r$\nYou can change both choices later in Sync's Options."
    Pop $0

    ${NSD_CreateLink} 0 90u 100% 10u "Read the full page: What Sync sends, and where"
    Pop $0
    ${NSD_OnClick} $0 OpenWhatSyncSendsPage

    ${NSD_CreateCheckbox} 0 106u 100% 12u "Check for new versions automatically"
    Pop $checkForUpdatesCheckbox
    ${if} $checkForUpdatesChoice != "0"
      ${NSD_Check} $checkForUpdatesCheckbox
    ${endIf}

    ${NSD_CreateCheckbox} 0 122u 100% 12u "Start Sync when Windows starts"
    Pop $startWithWindowsCheckbox
    ${if} $startWithWindowsChoice != "0"
      ${NSD_Check} $startWithWindowsCheckbox
    ${endIf}

    nsDialogs::Show
  FunctionEnd

  Function WhatSyncSendsPageLeave
    ${NSD_GetState} $checkForUpdatesCheckbox $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $checkForUpdatesChoice "1"
    ${else}
      StrCpy $checkForUpdatesChoice "0"
    ${endIf}
    ${NSD_GetState} $startWithWindowsCheckbox $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $startWithWindowsChoice "1"
    ${else}
      StrCpy $startWithWindowsChoice "0"
    ${endIf}
  FunctionEnd

  ; nsDialogs hands the clicked link to the function on the stack.
  Function OpenWhatSyncSendsPage
    Pop $0
    ExecShell "open" "${PRIVACY_PAGE_URL}"
  FunctionEnd
!macroend

; Registers the dancedance-sync:// link scheme for the current user, so the website's "Open in Sync app" opens the app
; even before it first runs (the app registers it again at every start). Keep the scheme in step with
; SYNC_LINK_SCHEME in src/main/sync-link.ts.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\dancedance-sync" "" "URL:dancedance.studio Sync"
  WriteRegStr SHELL_CONTEXT "Software\Classes\dancedance-sync" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\dancedance-sync\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\dancedance-sync\shell\open\command" "" '"$appExe" "%1"'
  ${ifNot} ${isUpdated}
    !insertmacro writeInstallerChoices
  ${endIf}
!macroend

!macro writeInstallerChoices
  Push $R7
  Push $R8
  Push $R9
  System::Call 'ole32::CoCreateGuid(g .R7)'
  StrCpy $R8 "true"
  ${if} $checkForUpdatesChoice == "0"
    StrCpy $R8 "false"
  ${endIf}
  StrCpy $R9 "true"
  ${if} $startWithWindowsChoice == "0"
    StrCpy $R9 "false"
  ${endIf}
  FileOpen $0 "$INSTDIR\installer-choices.json" w
  FileWrite $0 '{"installId":"$R7","isAutomaticUpdateCheckOn":$R8,"shouldStartWithWindows":$R9}$\r$\n'
  FileClose $0
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

; An update runs the old uninstaller first; the scheme and the start-with-Windows value stay then, and go only when the
; player really uninstalls. installer-choices.json goes with the app folder.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHELL_CONTEXT "Software\Classes\dancedance-sync"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${START_WITH_WINDOWS_VALUE_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${START_WITH_WINDOWS_VALUE_NAME}"
  ${endIf}
!macroend
