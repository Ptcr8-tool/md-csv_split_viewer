Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "nsDialogs.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "Sections.nsh"
!include "StrFunc.nsh"
${StrStr}
${UnStrStr}
!ifndef VERSION
!define VERSION "1.0.0"
!endif
!ifndef PAYLOAD
!define PAYLOAD "..\release\MD-Split"
!endif
!ifndef OUTPUT
!define OUTPUT "..\release\MD-Split-${VERSION}-Setup.exe"
!endif
!define PRODUCT_ID "d5e18334-d3e0-4bed-bdc4-729269684443"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MD Split"
Name "MD-CSV Split Editor ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\MD Split"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user
ManifestDPIAware true
!ifndef COMPRESSOR
!define COMPRESSOR zlib
!endif
SetCompressor /SOLID ${COMPRESSOR}
CRCCheck force
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1041 "ProductName" "MD-CSV Split Editor セットアップ"
VIAddVersionKey /LANG=1041 "FileDescription" "MD-CSV Split Editor オフラインセットアップ"
VIAddVersionKey /LANG=1041 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1041 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1041 "LegalCopyright" "MD Split contributors"
Icon "..\native\app.ico"
UninstallIcon "..\native\app.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "MD-CSV Split Editor をセットアップ"
!define MUI_WELCOMEPAGE_TEXT "このexeにアプリと実行環境がすべて含まれています。セットアップはインターネットに接続しません。$\r$\n$\r$\nインストール先とWindowsへの登録を選べます。既定アプリはインストール後に設定します。更新では設定・復元データを引き継ぎます。$\r$\n$\r$\nMD-CSV Split Editorを終了してから進めてください。"
!define MUI_COMPONENTSPAGE_TEXT_TOP "Windowsへの登録を選んでください。既定アプリはインストール後、設定から選べます。登録を消すときはUninstall.exeを使います。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "MD-CSV Split Editor専用の、書き込み可能なローカルフォルダーを選んでください。アンインストール時はこのフォルダー全体を削除します。作成した文書は別の場所へ保存してください。"
!insertmacro MUI_PAGE_WELCOME
!define MUI_LICENSEPAGE_TEXT_TOP "同梱するMicrosoft Edge WebView2 Runtime（Fixed Version）の使用条件です。内容を確認し、同意する場合に進んでください。全文はインストール後もLicensesフォルダーに保存します。"
!define MUI_LICENSEPAGE_CHECKBOX
!insertmacro MUI_PAGE_LICENSE "..\licenses\WebView2-Fixed-Runtime.txt"
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateDirectory
!insertmacro MUI_PAGE_DIRECTORY
Page custom MaintenancePage MaintenanceLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\MD-Split.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_TEXT "セットアップが完了しました。$\r$\n.md・.csv・.txt・.htmlなどの既定アプリにする場合は、アプリの設定からWindowsの「既定のアプリ」を開き、種類ごとに選んでください。$\r$\n$\r$\nヘルプから使い方・Discordモード・更新方法を確認できます。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "Japanese"
Var ExistingVersion
Var Comparison
Var RepairRadio
Var UninstallRadio
Var CancelRadio
Var IsUpdate
!include "DirectoryValidation.nsh"

Function ValidateDirectory
  Call CheckInstallDirectory
  ${If} $DirectoryError == ""
    Return
  ${ElseIf} $DirectoryError == "protected-path"
    MessageBox MB_ICONSTOP "専用のフォルダーを選んでください。"
  ${ElseIf} $DirectoryError == "network-path"
    MessageBox MB_ICONSTOP "ネットワーク上のフォルダーは指定できません。"
  ${ElseIf} $DirectoryError == "windows-path"
    MessageBox MB_ICONSTOP "Windowsのフォルダー内は指定できません。"
  ${ElseIf} $DirectoryError == "reparse-point"
    MessageBox MB_ICONSTOP "リンクされたフォルダーは指定できません。"
  ${ElseIf} $DirectoryError == "directory-not-empty"
    MessageBox MB_ICONSTOP "このフォルダーには別のファイルがあります。空の専用フォルダーを選んでください。"
  ${ElseIf} $DirectoryError == "target-file"
    MessageBox MB_ICONSTOP "指定したパスにはフォルダーではなくファイルがあります。専用のフォルダーを選んでください。"
  ${ElseIf} $DirectoryError == "invalid-path"
    MessageBox MB_ICONSTOP "インストール先のパスが正しくありません。ドライブから始まるローカルの専用フォルダーを選んでください。"
  ${Else}
    MessageBox MB_ICONSTOP "インストール先を確認できませんでした。アクセスできるローカルの専用フォルダーを選んでください。"
  ${EndIf}
  Abort
FunctionEnd

Function DetectVersion
  StrCpy $ExistingVersion ""
  ${If} $ExistingOwned == 1
    ClearErrors
    GetDLLVersion "$INSTDIR\MD-Split.dll" $0 $1
    ${IfNot} ${Errors}
      IntOp $2 $0 >> 16
      IntOp $3 $0 & 0xffff
      IntOp $4 $1 >> 16
      IntOp $5 $1 & 0xffff
      StrCpy $ExistingVersion "$2.$3.$4.$5"
    ${Else}
      ReadINIStr $ExistingVersion "$INSTDIR\install.ini" "MD Split" "Version"
    ${EndIf}
  ${EndIf}
  StrCpy $Comparison 2
  ${If} $ExistingVersion != ""
    ${VersionCompare} "$ExistingVersion" "${VERSION}" $Comparison
  ${EndIf}
FunctionEnd

Function MaintenancePage
  Call DetectVersion
  ${If} $ExistingVersion == ""
    Abort
  ${EndIf}
  ${If} $Comparison == 2
    ; Older installed version: normal upgrade, preserve Data.
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "インストール済みの版を確認" "同じ版または新しい版がインストールされています。"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 35u "インストール済み: $ExistingVersion$\r$\nこのセットアップ: ${VERSION}$\r$\n設定を引き継いで修復するか、アンインストールできます。"
  Pop $0
  ${NSD_CreateRadioButton} 5u 48u 100% 18u "修復（新しい版を古い版で上書きしません）"
  Pop $RepairRadio
  ${NSD_CreateRadioButton} 5u 75u 100% 18u "アンインストール（設定・履歴も削除）"
  Pop $UninstallRadio
  ${NSD_CreateRadioButton} 5u 102u 100% 18u "キャンセル"
  Pop $CancelRadio
  ${NSD_Check} $RepairRadio
  nsDialogs::Show
FunctionEnd

Function MaintenanceLeave
  ${NSD_GetState} $CancelRadio $0
  ${If} $0 == ${BST_CHECKED}
    Quit
  ${EndIf}
  ${NSD_GetState} $UninstallRadio $0
  ${If} $0 == ${BST_CHECKED}
    ${If} ${FileExists} "$INSTDIR\Uninstall.exe"
      Exec '"$INSTDIR\Uninstall.exe"'
      Quit
    ${Else}
      MessageBox MB_ICONINFORMATION "この旧版にはアンインストーラーがありません。修復を行うと、Uninstall.exeを登録できます。"
      Abort
    ${EndIf}
  ${EndIf}
  ${If} $Comparison == 1
    ; Delegate repair to the installed newer version and its verified cache.
    Exec '"$INSTDIR\MD-Split.exe" --repair'
    Quit
  ${EndIf}
FunctionEnd

Section "アプリ本体・オフライン実行環境（必須）" SecCore
  SectionIn RO
  Call ValidateDirectory
  Call DetectVersion
  ${If} $Comparison == 1
    IfSilent 0 +3
      SetErrorLevel 2
      Quit
    MessageBox MB_ICONSTOP "新しい版がインストールされています。修復メニューを使用してください。"
    Abort
  ${EndIf}
  ; No command interpreter, network plugin, forced termination, or remote script.
  StrCpy $4 0
  retry:
    nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq MD-Split.exe" /FO CSV /NH'
    Pop $0
    Pop $1
    ${StrStr} $2 $1 '"MD-Split.exe"'
    ${If} $2 != ""
      ${If} $IsUpdate == 1
        IntOp $4 $4 + 1
        ${If} $4 < 30
          Sleep 500
          Goto retry
        ${EndIf}
      ${EndIf}
      IfSilent 0 +3
        SetErrorLevel 3
        Abort
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "MD-CSV Split Editorを終了してから再試行してください。未保存の文書はアプリで保存してください。" IDRETRY retry
      Abort
    ${EndIf}
  Sleep 1000
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r /x ".*" "${PAYLOAD}\*.*"
  CreateDirectory "$INSTDIR\Data"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteINIStr "$INSTDIR\install.ini" "MD Split" "ProductId" "${PRODUCT_ID}"
  WriteINIStr "$INSTDIR\install.ini" "MD Split" "Version" "${VERSION}"
  ; Required AppContainer read permissions for fixed WebView2 on Windows 10.
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\WebView2Runtime" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /T /Q'
  Pop $0
  ${If} $0 != 0
    DetailPrint "WebView2 Runtime access setup failed: $0"
    MessageBox MB_ICONEXCLAMATION "表示環境のアクセス権を設定できませんでした。書き込み可能な専用フォルダーで再試行してください。"
    Abort
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\WebView2Runtime" /grant "*S-1-15-2-1:(OI)(CI)(RX)" /T /Q'
  Pop $0
  ${If} $0 != 0
    DetailPrint "WebView2 Runtime access setup failed: $0"
    MessageBox MB_ICONEXCLAMATION "表示環境のアクセス権を設定できませんでした。書き込み可能な専用フォルダーで再試行してください。"
    Abort
  ${EndIf}
SectionEnd

Section "スタートメニューに登録" SecStart
  ReadINIStr $0 "$INSTDIR\install.ini" "Options" "StartMenu"
  ${If} $0 == 1
    Delete "$SMPROGRAMS\MD Split.lnk"
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\MD-CSV Split Editor.lnk" "$INSTDIR\MD-Split.exe" "" "$INSTDIR\app.ico"
  WriteINIStr "$INSTDIR\install.ini" "Options" "StartMenu" "1"
SectionEnd
Section /o "デスクトップにショートカット" SecDesktop
  ReadINIStr $0 "$INSTDIR\install.ini" "Options" "Desktop"
  ${If} $0 == 1
    Delete "$DESKTOP\MD Split.lnk"
  ${EndIf}
  CreateShortcut "$DESKTOP\MD-CSV Split Editor.lnk" "$INSTDIR\MD-Split.exe" "" "$INSTDIR\app.ico"
  WriteINIStr "$INSTDIR\install.ini" "Options" "Desktop" "1"
SectionEnd
Section "Windowsのアプリ一覧・アンインストール登録" SecRegistration
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "MD-CSV Split Editor"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteINIStr "$INSTDIR\install.ini" "Options" "Registration" "1"
SectionEnd
; Candidate registration only. Windows does not permit an installer to set
; the user's default handler without their action in the Windows Settings UI.
; Hide this internal section so the components page never suggests otherwise.
Section -RegisterAssociation SecAssociation
  ExecWait '"$INSTDIR\MD-Split.exe" --register-quiet' $0
  ${If} $0 != 0
    DetailPrint "ファイルを開くアプリの候補に登録できませんでした。アプリの設定から再試行できます。"
    WriteINIStr "$INSTDIR\install.ini" "Options" "Association" "0"
  ${Else}
    WriteINIStr "$INSTDIR\install.ini" "Options" "Association" "1"
  ${EndIf}
SectionEnd
Section "オフライン修復用のセットアップを保存" SecCache
  CreateDirectory "$INSTDIR\Cache"
  ${If} $EXEPATH != "$INSTDIR\Cache\MD-Split-${VERSION}-Setup.exe"
    CopyFiles /SILENT "$EXEPATH" "$INSTDIR\Cache\MD-Split-${VERSION}-Setup.exe"
  ${EndIf}
  ExecWait '"$INSTDIR\MD-Split.exe" --record-installer "$INSTDIR\Cache\MD-Split-${VERSION}-Setup.exe"' $0
  WriteINIStr "$INSTDIR\install.ini" "Options" "Cache" "1"
SectionEnd

Section -FinalizeOptions
  SectionGetFlags ${SecStart} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 == 0
    ReadINIStr $1 "$INSTDIR\install.ini" "Options" "StartMenu"
    ${If} $1 == 1
      Delete "$SMPROGRAMS\MD-CSV Split Editor.lnk"
      Delete "$SMPROGRAMS\MD Split.lnk"
    ${EndIf}
    WriteINIStr "$INSTDIR\install.ini" "Options" "StartMenu" "0"
  ${EndIf}
  SectionGetFlags ${SecDesktop} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 == 0
    ReadINIStr $1 "$INSTDIR\install.ini" "Options" "Desktop"
    ${If} $1 == 1
      Delete "$DESKTOP\MD-CSV Split Editor.lnk"
      Delete "$DESKTOP\MD Split.lnk"
    ${EndIf}
    WriteINIStr "$INSTDIR\install.ini" "Options" "Desktop" "0"
  ${EndIf}
  SectionGetFlags ${SecRegistration} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 == 0
    ReadRegStr $1 HKCU "${UNINSTALL_KEY}" "InstallLocation"
    ${If} $1 == $INSTDIR
      DeleteRegKey HKCU "${UNINSTALL_KEY}"
    ${EndIf}
    WriteINIStr "$INSTDIR\install.ini" "Options" "Registration" "0"
  ${EndIf}
  SectionGetFlags ${SecCache} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 == 0
    RMDir /r "$INSTDIR\Cache"
    WriteINIStr "$INSTDIR\install.ini" "Options" "Cache" "0"
  ${EndIf}
SectionEnd

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "このセットアップは64ビット版Windows用です。"
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Windows 10以降が必要です。"
    Abort
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $IsUpdate 1
  ${EndIf}
  ; The older app may still pass /REPAIR. MaintenancePage detects an existing
  ; installation and defaults to Repair, so no flag is needed here.
  ${If} ${FileExists} "$INSTDIR\install.ini"
    ReadINIStr $0 "$INSTDIR\install.ini" "MD Split" "ProductId"
    ${If} $0 == "${PRODUCT_ID}"
      ReadINIStr $0 "$INSTDIR\install.ini" "Options" "StartMenu"
      ${If} $0 != 1
        !insertmacro UnselectSection ${SecStart}
      ${EndIf}
      ReadINIStr $0 "$INSTDIR\install.ini" "Options" "Desktop"
      ${If} $0 == 1
        !insertmacro SelectSection ${SecDesktop}
      ${EndIf}
      ReadINIStr $0 "$INSTDIR\install.ini" "Options" "Registration"
      ${If} $0 != 1
        !insertmacro UnselectSection ${SecRegistration}
      ${EndIf}
      ReadINIStr $0 "$INSTDIR\install.ini" "Options" "Cache"
      ${If} $0 != 1
        !insertmacro UnselectSection ${SecCache}
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd


Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ReadINIStr $0 "$INSTDIR\install.ini" "MD Split" "ProductId"
  ${If} $0 != "${PRODUCT_ID}"
    MessageBox MB_ICONSTOP "MD-CSV Split Editor専用フォルダーと確認できないため、削除を中止しました。"
    Abort
  ${EndIf}
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == "$0\"
  ${OrIf} $INSTDIR == "$PROFILE"
  ${OrIf} $INSTDIR == "$LOCALAPPDATA"
  ${OrIf} $INSTDIR == "$WINDIR"
  ${OrIf} $INSTDIR == "$PROGRAMFILES64"
  ${OrIf} $INSTDIR == "$PROGRAMFILES32"
  ${OrIf} $INSTDIR == "$SYSDIR"
    Abort
  ${EndIf}
  StrLen $0 "$WINDIR\"
  StrCpy $1 "$INSTDIR\" $0
  ${If} $1 == "$WINDIR\"
    Abort
  ${EndIf}
  StrCpy $1 $INSTDIR
  un_parent:
    System::Call 'kernel32::GetFileAttributesW(w r1)i.r2'
    ${If} $2 != -1
      IntOp $2 $2 & 0x400
      ${If} $2 != 0
        MessageBox MB_ICONSTOP "リンクされたフォルダーの削除を中止しました。"
        Abort
      ${EndIf}
    ${EndIf}
    ${GetParent} "$1" $2
    ${If} $2 == $1
    ${OrIf} $2 == ""
      Goto un_safe
    ${EndIf}
    StrCpy $1 $2
    Goto un_parent
  un_safe:
FunctionEnd
Function .onInstSuccess
  IfSilent 0 done_success
  ${If} $IsUpdate == 1
    Exec '"$INSTDIR\MD-Split.exe"'
  ${EndIf}
  done_success:
FunctionEnd
Section "Uninstall"
  retry_un:
    nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq MD-Split.exe" /FO CSV /NH'
    Pop $0
    Pop $1
    ${UnStrStr} $2 $1 '"MD-Split.exe"'
    ${If} $2 != ""
      IfSilent 0 +3
        SetErrorLevel 3
        Abort
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "MD-CSV Split Editorを終了してから再試行してください。" IDRETRY retry_un
      Abort
    ${EndIf}
  ExecWait '"$INSTDIR\MD-Split.exe" --unregister-quiet' $0
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\install.ini" "Options" "StartMenu"
  ${If} $0 == 1
    Delete "$SMPROGRAMS\MD-CSV Split Editor.lnk"
    Delete "$SMPROGRAMS\MD Split.lnk"
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\install.ini" "Options" "Desktop"
  ${If} $0 == 1
    Delete "$DESKTOP\MD-CSV Split Editor.lnk"
    Delete "$DESKTOP\MD Split.lnk"
  ${EndIf}
  RMDir /r "$INSTDIR"
SectionEnd
