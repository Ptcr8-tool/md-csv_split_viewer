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
!define VERSION "1.1.0"
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
!define MUI_WELCOMEPAGE_TITLE "$(WelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(WelcomeText)"
!define MUI_COMPONENTSPAGE_TEXT_TOP "$(ComponentsTop)"
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(DirectoryTop)"
!insertmacro MUI_PAGE_WELCOME
!define MUI_LICENSEPAGE_TEXT_TOP "$(LicenseTop)"
!define MUI_LICENSEPAGE_CHECKBOX
!insertmacro MUI_PAGE_LICENSE "..\licenses\WebView2-Fixed-Runtime.txt"
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateDirectory
!insertmacro MUI_PAGE_DIRECTORY
Page custom MaintenancePage MaintenanceLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\MD-Split.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_TEXT "$(FinishText)"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
Var ExistingVersion
Var Comparison
Var RepairRadio
Var UninstallRadio
Var CancelRadio
Var IsUpdate
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Japanese"
LangString WelcomeTitle ${LANG_ENGLISH} "Set up MD-CSV Split Editor"
LangString WelcomeTitle ${LANG_JAPANESE} "MD-CSV Split Editor をセットアップ"
LangString WelcomeText ${LANG_ENGLISH} "This installer includes the app and its runtime. Setup does not connect to the Internet.$\r$\n$\r$\nChoose an installation folder and Windows integrations. Choose default apps after installation. Updates preserve settings and recovery data.$\r$\n$\r$\nClose MD-CSV Split Editor before continuing."
LangString WelcomeText ${LANG_JAPANESE} "このexeにアプリと実行環境がすべて含まれています。セットアップはインターネットに接続しません。$\r$\n$\r$\nインストール先とWindowsへの登録を選べます。既定アプリはインストール後に設定します。更新では設定・復元データを引き継ぎます。$\r$\n$\r$\nMD-CSV Split Editorを終了してから進めてください。"
LangString ComponentsTop ${LANG_ENGLISH} "Choose Windows integrations. Choose default apps in Settings after installation. Use Uninstall.exe to remove registrations."
LangString ComponentsTop ${LANG_JAPANESE} "Windowsへの登録を選んでください。既定アプリはインストール後、設定から選べます。登録を消すときはUninstall.exeを使います。"
LangString DirectoryTop ${LANG_ENGLISH} "Choose a writable local folder dedicated to MD-CSV Split Editor. The entire folder will be removed during uninstallation. Save your documents elsewhere."
LangString DirectoryTop ${LANG_JAPANESE} "MD-CSV Split Editor専用の、書き込み可能なローカルフォルダーを選んでください。アンインストール時はこのフォルダー全体を削除します。作成した文書は別の場所へ保存してください。"
LangString LicenseTop ${LANG_ENGLISH} "These are the terms for the included Microsoft Edge WebView2 Runtime (Fixed Version). Review and accept them to continue. A copy remains in the Licenses folder."
LangString LicenseTop ${LANG_JAPANESE} "同梱するMicrosoft Edge WebView2 Runtime（Fixed Version）の使用条件です。内容を確認し、同意する場合に進んでください。全文はインストール後もLicensesフォルダーに保存します。"
LangString FinishText ${LANG_ENGLISH} "Setup is complete.$\r$\nTo use this app by default for .md, .csv, .txt or .html files, open Windows Default apps from the app settings and choose it for each type.$\r$\n$\r$\nSee Help for instructions, Discord mode and updates."
LangString FinishText ${LANG_JAPANESE} "セットアップが完了しました。$\r$\n.md・.csv・.txt・.htmlなどの既定アプリにする場合は、アプリの設定からWindowsの「既定のアプリ」を開き、種類ごとに選んでください。$\r$\n$\r$\nヘルプから使い方・Discordモード・更新方法を確認できます。"
LangString DirProtected ${LANG_ENGLISH} "Choose a dedicated folder."
LangString DirProtected ${LANG_JAPANESE} "専用のフォルダーを選んでください。"
LangString DirNetwork ${LANG_ENGLISH} "A network folder cannot be used."
LangString DirNetwork ${LANG_JAPANESE} "ネットワーク上のフォルダーは指定できません。"
LangString DirWindows ${LANG_ENGLISH} "A folder inside Windows cannot be used."
LangString DirWindows ${LANG_JAPANESE} "Windowsのフォルダー内は指定できません。"
LangString DirLink ${LANG_ENGLISH} "A linked folder cannot be used."
LangString DirLink ${LANG_JAPANESE} "リンクされたフォルダーは指定できません。"
LangString DirNonempty ${LANG_ENGLISH} "This folder contains other files. Choose an empty dedicated folder."
LangString DirNonempty ${LANG_JAPANESE} "このフォルダーには別のファイルがあります。空の専用フォルダーを選んでください。"
LangString DirFile ${LANG_ENGLISH} "The selected path is a file, not a folder. Choose a dedicated folder."
LangString DirFile ${LANG_JAPANESE} "指定したパスにはフォルダーではなくファイルがあります。専用のフォルダーを選んでください。"
LangString DirInvalid ${LANG_ENGLISH} "The installation path is invalid. Choose a dedicated local folder starting with a drive letter."
LangString DirInvalid ${LANG_JAPANESE} "インストール先のパスが正しくありません。ドライブから始まるローカルの専用フォルダーを選んでください。"
LangString DirUnknown ${LANG_ENGLISH} "Could not verify the installation folder. Choose an accessible dedicated local folder."
LangString DirUnknown ${LANG_JAPANESE} "インストール先を確認できませんでした。アクセスできるローカルの専用フォルダーを選んでください。"
LangString MaintenanceTitle ${LANG_ENGLISH} "Check the installed version"
LangString MaintenanceTitle ${LANG_JAPANESE} "インストール済みの版を確認"
LangString MaintenanceSubtitle ${LANG_ENGLISH} "The same or a newer version is installed."
LangString MaintenanceSubtitle ${LANG_JAPANESE} "同じ版または新しい版がインストールされています。"
LangString MaintenanceInfo ${LANG_ENGLISH} "Installed version: $ExistingVersion$\r$\nThis setup: ${VERSION}$\r$\nRepair while preserving settings, or uninstall."
LangString MaintenanceInfo ${LANG_JAPANESE} "インストール済み: $ExistingVersion$\r$\nこのセットアップ: ${VERSION}$\r$\n設定を引き継いで修復するか、アンインストールできます。"
LangString Repair ${LANG_ENGLISH} "Repair (a newer version will not be replaced by an older version)"
LangString Repair ${LANG_JAPANESE} "修復（新しい版を古い版で上書きしません）"
LangString Uninstall ${LANG_ENGLISH} "Uninstall (also removes settings and history)"
LangString Uninstall ${LANG_JAPANESE} "アンインストール（設定・履歴も削除）"
LangString Cancel ${LANG_ENGLISH} "Cancel"
LangString Cancel ${LANG_JAPANESE} "キャンセル"
LangString MissingUninstaller ${LANG_ENGLISH} "This older version has no uninstaller. Repair to register Uninstall.exe."
LangString MissingUninstaller ${LANG_JAPANESE} "この旧版にはアンインストーラーがありません。修復を行うと、Uninstall.exeを登録できます。"
LangString NewerInstalled ${LANG_ENGLISH} "A newer version is installed. Use the repair menu."
LangString NewerInstalled ${LANG_JAPANESE} "新しい版がインストールされています。修復メニューを使用してください。"
LangString CloseAppSave ${LANG_ENGLISH} "Close MD-CSV Split Editor and try again. Save any unsaved documents first."
LangString CloseAppSave ${LANG_JAPANESE} "MD-CSV Split Editorを終了してから再試行してください。未保存の文書はアプリで保存してください。"
LangString AccessFailed ${LANG_ENGLISH} "Could not set runtime access permissions. Retry with a writable dedicated folder."
LangString AccessFailed ${LANG_JAPANESE} "表示環境のアクセス権を設定できませんでした。書き込み可能な専用フォルダーで再試行してください。"
LangString Core ${LANG_ENGLISH} "Application and offline runtime (required)"
LangString Core ${LANG_JAPANESE} "アプリ本体・オフライン実行環境（必須）"
LangString Context ${LANG_ENGLISH} "Add this app to the file and folder context menu"
LangString Context ${LANG_JAPANESE} "すべてのファイルとフォルダーの右クリックに本アプリを追加"
LangString ContextError ${LANG_ENGLISH} "Could not register the context menu. Retry from the app settings."
LangString ContextError ${LANG_JAPANESE} "右クリックメニューを登録できませんでした。アプリの設定から再試行できます。"
LangString Start ${LANG_ENGLISH} "Add to Start menu"
LangString Start ${LANG_JAPANESE} "スタートメニューに登録"
LangString Desktop ${LANG_ENGLISH} "Create desktop shortcut"
LangString Desktop ${LANG_JAPANESE} "デスクトップにショートカット"
LangString Registration ${LANG_ENGLISH} "Register in Windows apps and uninstall list"
LangString Registration ${LANG_JAPANESE} "Windowsのアプリ一覧・アンインストール登録"
LangString AssociationError ${LANG_ENGLISH} "Could not register as an application candidate. Retry from the app settings."
LangString AssociationError ${LANG_JAPANESE} "ファイルを開くアプリの候補に登録できませんでした。アプリの設定から再試行できます。"
LangString Cache ${LANG_ENGLISH} "Save setup for offline repair"
LangString Cache ${LANG_JAPANESE} "オフライン修復用のセットアップを保存"
LangString Requires64 ${LANG_ENGLISH} "This setup requires 64-bit Windows."
LangString Requires64 ${LANG_JAPANESE} "このセットアップは64ビット版Windows用です。"
LangString Requires10 ${LANG_ENGLISH} "Windows 10 or later is required."
LangString Requires10 ${LANG_JAPANESE} "Windows 10以降が必要です。"
LangString UnsafeUninstall ${LANG_ENGLISH} "Uninstallation stopped because the folder could not be verified as belonging to MD-CSV Split Editor."
LangString UnsafeUninstall ${LANG_JAPANESE} "MD-CSV Split Editor専用フォルダーと確認できないため、削除を中止しました。"
LangString UnsafeLink ${LANG_ENGLISH} "Uninstallation stopped because the folder is linked."
LangString UnsafeLink ${LANG_JAPANESE} "リンクされたフォルダーの削除を中止しました。"
LangString CloseApp ${LANG_ENGLISH} "Close MD-CSV Split Editor and try again."
LangString CloseApp ${LANG_JAPANESE} "MD-CSV Split Editorを終了してから再試行してください。"
!include "DirectoryValidation.nsh"

Function ValidateDirectory
  Call CheckInstallDirectory
  ${If} $DirectoryError == ""
    Return
  ${ElseIf} $DirectoryError == "protected-path"
    MessageBox MB_ICONSTOP "$(DirProtected)"
  ${ElseIf} $DirectoryError == "network-path"
    MessageBox MB_ICONSTOP "$(DirNetwork)"
  ${ElseIf} $DirectoryError == "windows-path"
    MessageBox MB_ICONSTOP "$(DirWindows)"
  ${ElseIf} $DirectoryError == "reparse-point"
    MessageBox MB_ICONSTOP "$(DirLink)"
  ${ElseIf} $DirectoryError == "directory-not-empty"
    MessageBox MB_ICONSTOP "$(DirNonempty)"
  ${ElseIf} $DirectoryError == "target-file"
    MessageBox MB_ICONSTOP "$(DirFile)"
  ${ElseIf} $DirectoryError == "invalid-path"
    MessageBox MB_ICONSTOP "$(DirInvalid)"
  ${Else}
    MessageBox MB_ICONSTOP "$(DirUnknown)"
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
  !insertmacro MUI_HEADER_TEXT "$(MaintenanceTitle)" "$(MaintenanceSubtitle)"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 35u "$(MaintenanceInfo)"
  Pop $0
  ${NSD_CreateRadioButton} 5u 48u 100% 18u "$(Repair)"
  Pop $RepairRadio
  ${NSD_CreateRadioButton} 5u 75u 100% 18u "$(Uninstall)"
  Pop $UninstallRadio
  ${NSD_CreateRadioButton} 5u 102u 100% 18u "$(Cancel)"
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
      MessageBox MB_ICONINFORMATION "$(MissingUninstaller)"
      Abort
    ${EndIf}
  ${EndIf}
  ${If} $Comparison == 1
    ; Delegate repair to the installed newer version and its verified cache.
    Exec '"$INSTDIR\MD-Split.exe" --repair'
    Quit
  ${EndIf}
FunctionEnd

Section "$(Core)" SecCore
  SectionIn RO
  Call ValidateDirectory
  Call DetectVersion
  ${If} $Comparison == 1
    IfSilent 0 +3
      SetErrorLevel 2
      Quit
    MessageBox MB_ICONSTOP "$(NewerInstalled)"
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
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseAppSave)" IDRETRY retry
      Abort
    ${EndIf}
  Sleep 1000
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r /x ".*" "${PAYLOAD}\*.*"
  CreateDirectory "$INSTDIR\Data"
  ; Pass the language to the app on a fresh install only. Existing settings
  ; and a previously written marker always take precedence during upgrades.
  ${IfNot} ${FileExists} "$INSTDIR\Data\settings.json"
  ${AndIfNot} ${FileExists} "$INSTDIR\Data\install-language.txt"
    FileOpen $0 "$INSTDIR\Data\install-language.txt" w
    ${If} $LANGUAGE == ${LANG_JAPANESE}
      FileWrite $0 "ja"
    ${Else}
      FileWrite $0 "en"
    ${EndIf}
    FileClose $0
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteINIStr "$INSTDIR\install.ini" "MD Split" "ProductId" "${PRODUCT_ID}"
  WriteINIStr "$INSTDIR\install.ini" "MD Split" "Version" "${VERSION}"
  WriteINIStr "$INSTDIR\install.ini" "MD Split" "InstallerLanguage" "$LANGUAGE"
  ; Required AppContainer read permissions for fixed WebView2 on Windows 10.
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\WebView2Runtime" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /T /Q'
  Pop $0
  ${If} $0 != 0
    DetailPrint "WebView2 Runtime access setup failed: $0"
    MessageBox MB_ICONEXCLAMATION "$(AccessFailed)"
    Abort
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\WebView2Runtime" /grant "*S-1-15-2-1:(OI)(CI)(RX)" /T /Q'
  Pop $0
  ${If} $0 != 0
    DetailPrint "WebView2 Runtime access setup failed: $0"
    MessageBox MB_ICONEXCLAMATION "$(AccessFailed)"
    Abort
  ${EndIf}
SectionEnd

Section /o "$(Context)" SecContextMenu
  ExecWait '"$INSTDIR\MD-Split.exe" --context-menu-enable' $0
  ${If} $0 != 0
    DetailPrint "$(ContextError)"
  ${EndIf}
SectionEnd

Section "$(Start)" SecStart
  ReadINIStr $0 "$INSTDIR\install.ini" "Options" "StartMenu"
  ${If} $0 == 1
    Delete "$SMPROGRAMS\MD Split.lnk"
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\MD-CSV Split Editor.lnk" "$INSTDIR\MD-Split.exe" "" "$INSTDIR\app.ico"
  WriteINIStr "$INSTDIR\install.ini" "Options" "StartMenu" "1"
SectionEnd
Section /o "$(Desktop)" SecDesktop
  ReadINIStr $0 "$INSTDIR\install.ini" "Options" "Desktop"
  ${If} $0 == 1
    Delete "$DESKTOP\MD Split.lnk"
  ${EndIf}
  CreateShortcut "$DESKTOP\MD-CSV Split Editor.lnk" "$INSTDIR\MD-Split.exe" "" "$INSTDIR\app.ico"
  WriteINIStr "$INSTDIR\install.ini" "Options" "Desktop" "1"
SectionEnd
Section "$(Registration)" SecRegistration
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
    DetailPrint "$(AssociationError)"
    WriteINIStr "$INSTDIR\install.ini" "Options" "Association" "0"
  ${Else}
    WriteINIStr "$INSTDIR\install.ini" "Options" "Association" "1"
  ${EndIf}
SectionEnd
Section "$(Cache)" SecCache
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
  ; Use Japanese if Windows does not report a language. Other unsupported
  ; languages fall back to English.
  System::Call 'kernel32::GetUserDefaultUILanguage() i.r0'
  IntOp $0 $0 & 0x3ff
  StrCpy $LANGUAGE ${LANG_JAPANESE}
  ${If} $0 != 0
  ${AndIf} $0 != 17
    StrCpy $LANGUAGE ${LANG_ENGLISH}
  ${EndIf}
  IfSilent language_ready
    !define MUI_LANGDLL_ALLLANGUAGES
    !define MUI_LANGDLL_WINDOWTITLE "Installer language / 言語"
    !define MUI_LANGDLL_INFO "Select a language / 言語を選択してください"
    !insertmacro MUI_LANGDLL_DISPLAY
  language_ready:
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "$(Requires64)"
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "$(Requires10)"
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
  ReadINIStr $0 "$INSTDIR\install.ini" "MD Split" "InstallerLanguage"
  ${If} $0 == ${LANG_JAPANESE}
  ${OrIf} $0 == ${LANG_ENGLISH}
    StrCpy $LANGUAGE $0
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\install.ini" "MD Split" "ProductId"
  ${If} $0 != "${PRODUCT_ID}"
    MessageBox MB_ICONSTOP "$(UnsafeUninstall)"
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
        MessageBox MB_ICONSTOP "$(UnsafeLink)"
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
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseApp)" IDRETRY retry_un
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

