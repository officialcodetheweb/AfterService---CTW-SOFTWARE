; After Service (CTW Software) — custom installer script for electron-builder
;  1. Licence activation page (first page). Installation cannot continue without a valid licence for THIS computer.
;  2. Workspace name page.   3. Optional After Service Player page.   4. Optional After Service Converter page.
; electron-builder reads this file BEFORE it loads the Modern UI, so MUI2 is included here (it has an include guard).
!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

; The public key is written to build\license-pub.nsh by "npm run license" (the licence generator).
!include /NONFATAL "license-pub.nsh"
!ifndef AS_LICENSE_PUBKEY
  !error "No licence key found. Run:  npm run license   once (it creates your keys and build\license-pub.nsh), then build again."
!endif

; Installer-only variables (electron-builder also compiles this file for the uninstaller,
; where unused variables are treated as errors).
!ifndef BUILD_UNINSTALLER
Var ASDialog
Var ASInput
Var ASName
Var ASPlayerBox
Var ASOpenWithBox
Var ASPlayer
Var ASOpenWith
Var ASHwid
Var ASLicense
Var ASLicBox
Var ASLicTries
Var ASConvBox
Var ASConvOpenBox
Var ASConv
Var ASConvOpen
!endif

!macro AS_EXTRACT_HELPER
  InitPluginsDir
  ${IfNot} ${FileExists} "$PLUGINSDIR\aslic.exe"
    File /oname=$PLUGINSDIR\aslic.exe "${BUILD_RESOURCES_DIR}\aslic.exe"
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
; ---------- Licence activation ----------
Function ASLicPageCreate
  !insertmacro MUI_HEADER_TEXT "Activate After Service" "A licence key for this computer is required to install After Service."
  !insertmacro AS_EXTRACT_HELPER
  ${If} $ASHwid == ""
    nsExec::ExecToStack '"$PLUGINSDIR\aslic.exe" hwid'
    Pop $0
    Pop $ASHwid
  ${EndIf}
  nsDialogs::Create 1018
  Pop $ASDialog
  ${If} $ASDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 26u "Send the Device ID below to CTW Software to receive your licence key. The licence only works on this computer."
  Pop $0
  ${NSD_CreateLabel} 0 30u 100% 10u "Your Device ID:"
  Pop $0
  ${NSD_CreateText} 0 42u 70% 14u "$ASHwid"
  Pop $0
  SendMessage $0 ${EM_SETREADONLY} 1 0
  CreateFont $1 "Consolas" 11 700
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_CreateButton} 72% 41u 28% 16u "Copy Device ID"
  Pop $0
  ${NSD_OnClick} $0 ASCopyHwid
  ${NSD_CreateLabel} 0 64u 100% 10u "Paste your licence key:"
  Pop $0
  nsDialogs::CreateControl EDIT ${DEFAULT_STYLES}|${WS_TABSTOP}|${ES_MULTILINE}|${ES_AUTOVSCROLL}|${WS_VSCROLL} ${WS_EX_CLIENTEDGE} 0 76u 100% 48u "$ASLicense"
  Pop $ASLicBox
  nsDialogs::Show
FunctionEnd

Function ASCopyHwid
  System::Call 'user32::OpenClipboard(p 0) i .r0'
  System::Call 'user32::EmptyClipboard()'
  StrLen $1 $ASHwid
  IntOp $1 $1 + 1
  IntOp $1 $1 * 2
  System::Call 'kernel32::GlobalAlloc(i 2, i r1) p .r2'
  System::Call 'kernel32::GlobalLock(p r2) p .r3'
  System::Call 'kernel32::lstrcpyW(p r3, w "$ASHwid")'
  System::Call 'kernel32::GlobalUnlock(p r2)'
  System::Call 'user32::SetClipboardData(i 13, p r2)'
  System::Call 'user32::CloseClipboard()'
  MessageBox MB_ICONINFORMATION "Device ID copied: $ASHwid$\r$\n$\r$\nSend it to CTW Software to get your licence key."
FunctionEnd

Function ASLicPageLeave
  ${NSD_GetText} $ASLicBox $ASLicense
  ${If} $ASLicense == ""
    MessageBox MB_ICONEXCLAMATION "Please paste your After Service licence key.$\r$\n$\r$\nNo licence? Send your Device ID ($ASHwid) to CTW Software."
    Abort
  ${EndIf}
  FileOpen $0 "$PLUGINSDIR\lic.txt" w
  FileWrite $0 "$ASLicense"
  FileClose $0
  nsExec::ExecToStack '"$PLUGINSDIR\aslic.exe" verifyfile ${AS_LICENSE_PUBKEY} "$PLUGINSDIR\lic.txt"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    IntOp $ASLicTries $ASLicTries + 1
    ${If} $ASLicTries >= 5
      MessageBox MB_ICONSTOP "The licence key was rejected 5 times. Installation has been cancelled.$\r$\n$\r$\n$1"
      Quit
    ${EndIf}
    MessageBox MB_ICONSTOP "This licence key cannot be used:$\r$\n$\r$\n$1"
    Abort
  ${EndIf}
  MessageBox MB_ICONINFORMATION "$1"
FunctionEnd

Function ASNamePageCreate
  !insertmacro MUI_HEADER_TEXT "Create Your Workspace" "All your After Service projects will be saved in this folder."
  nsDialogs::Create 1018
  Pop $ASDialog
  ${If} $ASDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 36u "Type your name or your church name. A folder with this name will be created in your Documents folder. Presets, overlays and all edited pictures will be saved inside it."
  Pop $0
  ${NSD_CreateLabel} 0 44u 100% 10u "Workspace folder name:"
  Pop $0
  ${NSD_CreateText} 0 56u 100% 13u "My Church"
  Pop $ASInput
  nsDialogs::Show
FunctionEnd

Function ASNamePageLeave
  ${NSD_GetText} $ASInput $ASName
  ${If} $ASName == ""
    MessageBox MB_ICONEXCLAMATION "Please enter a name for your workspace folder."
    Abort
  ${EndIf}
  SetShellVarContext current
  CreateDirectory "$APPDATA\After Service"
  FileOpen $0 "$APPDATA\After Service\workspace-name.txt" w
  FileWrite $0 "$ASName"
  FileClose $0
  CreateDirectory "$DOCUMENTS\$ASName"
FunctionEnd

; ---------- Optional: After Service Player (music & video player) ----------
Function ASPlayerPageCreate
  !insertmacro MUI_HEADER_TEXT "After Service Player" "A music and video player is included. Choose whether to install it."
  nsDialogs::Create 1018
  Pop $ASDialog
  ${If} $ASDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 40u "After Service Player plays your music, sermons and videos with shuffle, repeat, loop and a 10-band equalizer. It keeps playing in the background and shows a small Now Playing bar at the top of your screen."
  Pop $0
  ${NSD_CreateCheckbox} 0 48u 100% 12u "Install After Service Player (Start menu and desktop shortcuts)"
  Pop $ASPlayerBox
  ${NSD_Check} $ASPlayerBox
  ${NSD_CreateCheckbox} 12u 64u 100% 12u "Add After Service Player to $\"Open with$\" for music and video files"
  Pop $ASOpenWithBox
  ${NSD_Check} $ASOpenWithBox
  ${NSD_OnClick} $ASPlayerBox ASPlayerToggle
  nsDialogs::Show
FunctionEnd

Function ASPlayerToggle
  ${NSD_GetState} $ASPlayerBox $0
  ${If} $0 == ${BST_CHECKED}
    EnableWindow $ASOpenWithBox 1
  ${Else}
    EnableWindow $ASOpenWithBox 0
  ${EndIf}
FunctionEnd

Function ASPlayerPageLeave
  ${NSD_GetState} $ASPlayerBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ASPlayer "1"
  ${Else}
    StrCpy $ASPlayer "0"
  ${EndIf}
  ${NSD_GetState} $ASOpenWithBox $0
  ${If} $0 == ${BST_CHECKED}
  ${AndIf} $ASPlayer == "1"
    StrCpy $ASOpenWith "1"
  ${Else}
    StrCpy $ASOpenWith "0"
  ${EndIf}
FunctionEnd

; ---------- Optional: After Service Converter (file converter) ----------
Function ASConvPageCreate
  !insertmacro MUI_HEADER_TEXT "After Service Converter" "A file converter is included. Choose whether to install it."
  nsDialogs::Create 1018
  Pop $ASDialog
  ${If} $ASDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 40u "After Service Converter turns iPhone HEIC pictures into JPG and converts pictures, videos and music from one format to another: JPG, PNG, WEBP, ICO, AVIF, PDF, MP4, MOV, MKV, WEBM, GIF, MP3, WAV, M4A, FLAC and more."
  Pop $0
  ${NSD_CreateCheckbox} 0 48u 100% 12u "Install After Service Converter (Start menu and desktop shortcuts)"
  Pop $ASConvBox
  ${NSD_Check} $ASConvBox
  ${NSD_CreateCheckbox} 12u 64u 100% 12u "Add After Service Converter to $\"Open with$\" for HEIC and other pictures"
  Pop $ASConvOpenBox
  ${NSD_Check} $ASConvOpenBox
  ${NSD_OnClick} $ASConvBox ASConvToggle
  nsDialogs::Show
FunctionEnd

Function ASConvToggle
  ${NSD_GetState} $ASConvBox $0
  ${If} $0 == ${BST_CHECKED}
    EnableWindow $ASConvOpenBox 1
  ${Else}
    EnableWindow $ASConvOpenBox 0
  ${EndIf}
FunctionEnd

Function ASConvPageLeave
  ${NSD_GetState} $ASConvBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ASConv "1"
  ${Else}
    StrCpy $ASConv "0"
  ${EndIf}
  ${NSD_GetState} $ASConvOpenBox $0
  ${If} $0 == ${BST_CHECKED}
  ${AndIf} $ASConv == "1"
    StrCpy $ASConvOpen "1"
  ${Else}
    StrCpy $ASConvOpen "0"
  ${EndIf}
FunctionEnd

!endif ; BUILD_UNINSTALLER

!macro customWelcomePage
  Page custom ASLicPageCreate ASLicPageLeave
!macroend

; Silent installs / auto-updates skip the pages: they still need a valid licence already on this computer.
!macro customInit
  ${If} ${Silent}
    !insertmacro AS_EXTRACT_HELPER
    nsExec::ExecToStack '"$PLUGINSDIR\aslic.exe" hwid'
    Pop $0
    Pop $ASHwid
    nsExec::ExecToStack '"$PLUGINSDIR\aslic.exe" verifyfile ${AS_LICENSE_PUBKEY} "$APPDATA\After Service\license.key"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      SetErrorLevel 5
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom ASNamePageCreate ASNamePageLeave
  Page custom ASPlayerPageCreate ASPlayerPageLeave
  Page custom ASConvPageCreate ASConvPageLeave
!macroend

!macro ASOpenWithExt EXT
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "AfterService.Player" ""
!macroend
!macro ASOpenWithExtDel EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "AfterService.Player"
!macroend

!macro ASConvExt EXT
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "AfterService.Converter" ""
!macroend
!macro ASConvExtDel EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "AfterService.Converter"
!macroend

!macro customInstall
  ; Licence + installation fingerprint. A copied install folder will not match the next computer.
  CreateDirectory "$APPDATA\After Service"
  ${If} $ASLicense != ""
    FileOpen $0 "$APPDATA\After Service\license.key" w
    FileWrite $0 "$ASLicense"
    FileClose $0
  ${EndIf}
  FileOpen $0 "$INSTDIR\resources\install.bind" w
  FileWrite $0 "$ASHwid"
  FileClose $0
  ; Silent installs / updates keep the Player (empty = not asked = install)
  ${If} $ASPlayer != "0"
    CreateShortCut "$SMPROGRAMS\After Service Player.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--player" "$INSTDIR\resources\player.ico" 0
    CreateShortCut "$DESKTOP\After Service Player.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--player" "$INSTDIR\resources\player.ico" 0
    CreateDirectory "$APPDATA\After Service"
    FileOpen $0 "$APPDATA\After Service\player-installed.txt" w
    FileWrite $0 "1"
    FileClose $0
    ${If} $ASOpenWith != "0"
      WriteRegStr HKCU "Software\Classes\AfterService.Player" "" "After Service Player media"
      WriteRegStr HKCU "Software\Classes\AfterService.Player" "FriendlyAppName" "After Service Player"
      WriteRegStr HKCU "Software\Classes\AfterService.Player\DefaultIcon" "" "$INSTDIR\resources\player.ico"
      WriteRegStr HKCU "Software\Classes\AfterService.Player\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --player "%1"'
      !insertmacro ASOpenWithExt mp3
      !insertmacro ASOpenWithExt wav
      !insertmacro ASOpenWithExt m4a
      !insertmacro ASOpenWithExt aac
      !insertmacro ASOpenWithExt flac
      !insertmacro ASOpenWithExt ogg
      !insertmacro ASOpenWithExt opus
      !insertmacro ASOpenWithExt wma
      !insertmacro ASOpenWithExt mp4
      !insertmacro ASOpenWithExt m4v
      !insertmacro ASOpenWithExt mov
      !insertmacro ASOpenWithExt mkv
      !insertmacro ASOpenWithExt webm
      !insertmacro ASOpenWithExt avi
      !insertmacro ASOpenWithExt wmv
      System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
    ${EndIf}
  ${Else}
    Delete "$SMPROGRAMS\After Service Player.lnk"
    Delete "$DESKTOP\After Service Player.lnk"
    CreateDirectory "$APPDATA\After Service"
    FileOpen $0 "$APPDATA\After Service\player-installed.txt" w
    FileWrite $0 "0"
    FileClose $0
  ${EndIf}
  ; Converter — silent installs / updates keep it (empty = not asked = install)
  ${If} $ASConv != "0"
    CreateShortCut "$SMPROGRAMS\After Service Converter.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--converter" "$INSTDIR\resources\converter.ico" 0
    CreateShortCut "$DESKTOP\After Service Converter.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--converter" "$INSTDIR\resources\converter.ico" 0
    FileOpen $0 "$APPDATA\After Service\converter-installed.txt" w
    FileWrite $0 "1"
    FileClose $0
    ${If} $ASConvOpen != "0"
      WriteRegStr HKCU "Software\Classes\AfterService.Converter" "" "Convert with After Service"
      WriteRegStr HKCU "Software\Classes\AfterService.Converter" "FriendlyAppName" "After Service Converter"
      WriteRegStr HKCU "Software\Classes\AfterService.Converter\DefaultIcon" "" "$INSTDIR\resources\converter.ico"
      WriteRegStr HKCU "Software\Classes\AfterService.Converter\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --converter "%1"'
      !insertmacro ASConvExt heic
      !insertmacro ASConvExt heif
      !insertmacro ASConvExt jpg
      !insertmacro ASConvExt jpeg
      !insertmacro ASConvExt png
      !insertmacro ASConvExt webp
      !insertmacro ASConvExt bmp
      !insertmacro ASConvExt tif
      !insertmacro ASConvExt tiff
      !insertmacro ASConvExt gif
      !insertmacro ASConvExt avif
      !insertmacro ASConvExt ico
      System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
    ${EndIf}
  ${Else}
    Delete "$SMPROGRAMS\After Service Converter.lnk"
    Delete "$DESKTOP\After Service Converter.lnk"
    FileOpen $0 "$APPDATA\After Service\converter-installed.txt" w
    FileWrite $0 "0"
    FileClose $0
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\After Service Converter.lnk"
  Delete "$DESKTOP\After Service Converter.lnk"
  DeleteRegKey HKCU "Software\Classes\AfterService.Converter"
  !insertmacro ASConvExtDel heic
  !insertmacro ASConvExtDel heif
  !insertmacro ASConvExtDel jpg
  !insertmacro ASConvExtDel jpeg
  !insertmacro ASConvExtDel png
  !insertmacro ASConvExtDel webp
  !insertmacro ASConvExtDel bmp
  !insertmacro ASConvExtDel tif
  !insertmacro ASConvExtDel tiff
  !insertmacro ASConvExtDel gif
  !insertmacro ASConvExtDel avif
  !insertmacro ASConvExtDel ico
  Delete "$SMPROGRAMS\After Service Player.lnk"
  Delete "$DESKTOP\After Service Player.lnk"
  DeleteRegKey HKCU "Software\Classes\AfterService.Player"
  !insertmacro ASOpenWithExtDel mp3
  !insertmacro ASOpenWithExtDel wav
  !insertmacro ASOpenWithExtDel m4a
  !insertmacro ASOpenWithExtDel aac
  !insertmacro ASOpenWithExtDel flac
  !insertmacro ASOpenWithExtDel ogg
  !insertmacro ASOpenWithExtDel opus
  !insertmacro ASOpenWithExtDel wma
  !insertmacro ASOpenWithExtDel mp4
  !insertmacro ASOpenWithExtDel m4v
  !insertmacro ASOpenWithExtDel mov
  !insertmacro ASOpenWithExtDel mkv
  !insertmacro ASOpenWithExtDel webm
  !insertmacro ASOpenWithExtDel avi
  !insertmacro ASOpenWithExtDel wmv
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
