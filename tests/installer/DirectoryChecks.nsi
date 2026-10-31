; Runs the production directory validator against disposable Windows fixtures.
; No application payload, registry writes, network requests, or shell commands.
Unicode true
!ifdef HARNESS_AMD64
  Target amd64-unicode
!endif
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!define PRODUCT_ID "d5e18334-d3e0-4bed-bdc4-729269684443"
!include "..\..\installer\DirectoryValidation.nsh"
!ifndef OUTPUT
  !define OUTPUT "DirectoryChecks.exe"
!endif
Name "MD Split directory validation checks"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

Var FixtureRoot
Var FixturePath
Var FixtureHandle
Var DriveRoot
Var LogHandle
Var CaseName
Var ExpectedError
Var ExpectedOwned
Var ExpectedCanonical
Var ChecksPassed
Var ChecksFailed
Var ResultText

!macro Expect NAME INPUT ERROR OWNED CANONICAL
  StrCpy $CaseName "${NAME}"
  StrCpy $INSTDIR "${INPUT}"
  StrCpy $ExpectedError "${ERROR}"
  StrCpy $ExpectedOwned "${OWNED}"
  StrCpy $ExpectedCanonical "${CANONICAL}"
  Call RunCase
!macroend

!macro Touch PATH
  StrCpy $FixturePath "${PATH}"
  Call CreateFixtureFile
!macroend

!macro MakeDirectory PATH
  StrCpy $FixturePath "${PATH}"
  Call CreateFixtureDirectory
!macroend

Function CreateFixtureDirectory
  ClearErrors
  CreateDirectory "$FixturePath"
  ${If} ${Errors}
    FileWrite $LogHandle "FAIL fixture-directory-creation$\r$\n"
    FileClose $LogHandle
    SetErrorLevel 3
    Quit
  ${EndIf}
FunctionEnd

Function CreateFixtureFile
  ClearErrors
  FileOpen $FixtureHandle "$FixturePath" w
  ${If} ${Errors}
    FileWrite $LogHandle "FAIL fixture-creation$\r$\n"
    FileClose $LogHandle
    SetErrorLevel 3
    Quit
  ${EndIf}
  FileWrite $FixtureHandle "fixture"
  FileClose $FixtureHandle
FunctionEnd

Function RunCase
  ${If} $CaseName == "drive-root"
    ; Record only the argument's shape; the temporary drive and full path are
    ; deliberately not printed in public CI logs.
    StrLen $0 $INSTDIR
    StrCpy $1 $INSTDIR 1 1
    StrCpy $2 $INSTDIR 1 2
    StrCpy $3 "no"
    StrCpy $4 "no"
    ${If} $1 == ":"
      StrCpy $3 "yes"
    ${EndIf}
    ${If} $2 == "\"
      StrCpy $4 "yes"
    ${EndIf}
    FileWrite $LogHandle "INFO drive-root input-length=$0 colon=$3 slash=$4$\r$\n"
  ${EndIf}
  Call CheckInstallDirectory
  StrCpy $ResultText "PASS"
  ${If} $DirectoryError != $ExpectedError
  ${OrIf} $ExistingOwned != $ExpectedOwned
    StrCpy $ResultText "FAIL"
  ${EndIf}
  ${If} $ExpectedCanonical != ""
  ${AndIf} $INSTDIR != $ExpectedCanonical
    StrCpy $ResultText "FAIL"
  ${EndIf}
  ${If} $ResultText == "PASS"
    IntOp $ChecksPassed $ChecksPassed + 1
  ${Else}
    IntOp $ChecksFailed $ChecksFailed + 1
  ${EndIf}
  ; Never log input/canonical paths, usernames, environment values, or handles.
  FileWrite $LogHandle "$ResultText $CaseName expected=[$ExpectedError,$ExpectedOwned] actual=[$DirectoryError,$ExistingOwned]$\r$\n"
FunctionEnd

Section
  SetShellVarContext current
  StrCpy $ChecksPassed 0
  StrCpy $ChecksFailed 0
  ClearErrors
  FileOpen $LogHandle "$EXEDIR\DirectoryChecks.log" w
  ${If} ${Errors}
    SetErrorLevel 3
    Quit
  ${EndIf}
  FileWrite $LogHandle "MD Split production directory validator: Windows runtime checks$\r$\n"
  ${IfNot} ${RunningX64}
    FileWrite $LogHandle "FAIL requires-64-bit-Windows$\r$\n"
    FileClose $LogHandle
    SetErrorLevel 3
    Quit
  ${EndIf}
  ClearErrors
  GetTempFileName $FixtureRoot "$TEMP"
  ${If} ${Errors}
    FileWrite $LogHandle "FAIL temporary-fixture-creation$\r$\n"
    FileClose $LogHandle
    SetErrorLevel 3
    Quit
  ${EndIf}
  ; Only this unique file and the directory replacing it are ever deleted.
  Delete "$FixtureRoot"
  CreateDirectory "$FixtureRoot"
  ${If} ${Errors}
    FileWrite $LogHandle "FAIL temporary-fixture-creation$\r$\n"
    FileClose $LogHandle
    SetErrorLevel 3
    Quit
  ${EndIf}
  ${GetRoot} "$FixtureRoot" $DriveRoot

  !insertmacro MakeDirectory "$FixtureRoot\parent"
  !insertmacro MakeDirectory "$FixtureRoot\empty"
  !insertmacro MakeDirectory "$FixtureRoot\unknown-file"
  !insertmacro Touch "$FixtureRoot\unknown-file\note.txt"
  !insertmacro MakeDirectory "$FixtureRoot\hidden-file"
  !insertmacro Touch "$FixtureRoot\hidden-file\hidden.txt"
  SetFileAttributes "$FixtureRoot\hidden-file\hidden.txt" HIDDEN
  System::Call 'kernel32::GetFileAttributesW(w "$FixtureRoot\hidden-file\hidden.txt")i.r0'
  IntOp $1 $0 & 0x2
  ${If} $0 == -1
  ${OrIf} $1 == 0
    FileWrite $LogHandle "FAIL hidden-fixture-attribute$\r$\n"
    FileClose $LogHandle
    SetErrorLevel 3
    Quit
  ${EndIf}
  !insertmacro MakeDirectory "$FixtureRoot\child-only\child"
  !insertmacro MakeDirectory "$FixtureRoot\dot-file"
  !insertmacro Touch "$FixtureRoot\dot-file\.gitkeep"
  !insertmacro Touch "$FixtureRoot\ordinary-file"
  !insertmacro MakeDirectory "$FixtureRoot\managed"
  WriteINIStr "$FixtureRoot\managed\install.ini" "MD Split" "ProductId" "${PRODUCT_ID}"
  !insertmacro MakeDirectory "$FixtureRoot\legacy\wwwroot"
  !insertmacro Touch "$FixtureRoot\legacy\MD-Split.exe"
  !insertmacro Touch "$FixtureRoot\legacy\MD-Split.dll"
  !insertmacro Touch "$FixtureRoot\legacy\wwwroot\index.html"
  !insertmacro MakeDirectory "$FixtureRoot\foreign-marker"
  WriteINIStr "$FixtureRoot\foreign-marker\install.ini" "MD Split" "ProductId" "different-product"
  !insertmacro MakeDirectory "$FixtureRoot\日本語と space"

  !insertmacro Expect "missing-parent-and-leaf" "$FixtureRoot\missing-parent\MD Split" "" 0 "$FixtureRoot\missing-parent\MD Split"
  !insertmacro Expect "missing-leaf" "$FixtureRoot\parent\MD Split" "" 0 "$FixtureRoot\parent\MD Split"
  !insertmacro Expect "empty-directory" "$FixtureRoot\empty" "" 0 "$FixtureRoot\empty"
  !insertmacro Expect "unknown-file" "$FixtureRoot\unknown-file" "directory-not-empty" 0 ""
  !insertmacro Expect "hidden-file" "$FixtureRoot\hidden-file" "directory-not-empty" 0 ""
  !insertmacro Expect "child-directory-only" "$FixtureRoot\child-only" "directory-not-empty" 0 ""
  !insertmacro Expect "dot-prefixed-file" "$FixtureRoot\dot-file" "directory-not-empty" 0 ""
  !insertmacro Expect "target-is-file" "$FixtureRoot\ordinary-file" "target-file" 0 ""
  !insertmacro Expect "ancestor-is-file" "$FixtureRoot\ordinary-file\child" "target-file" 0 ""
  !insertmacro Expect "managed-install" "$FixtureRoot\managed" "" 1 "$FixtureRoot\managed"
  !insertmacro Expect "legacy-layout" "$FixtureRoot\legacy" "" 1 "$FixtureRoot\legacy"
  !insertmacro Expect "foreign-marker" "$FixtureRoot\foreign-marker" "directory-not-empty" 0 ""
  !insertmacro Expect "drive-root" "$DriveRoot\" "protected-path" 0 ""
  !insertmacro Expect "drive-root-special-variable-form" "$DriveRoot" "protected-path" 0 ""
  !insertmacro Expect "invalid-root-drive-letter" "1:" "invalid-path" 0 ""
  !insertmacro Expect "profile-root" "$PROFILE" "protected-path" 0 ""
  !insertmacro Expect "local-app-data-root" "$LOCALAPPDATA" "protected-path" 0 ""
  !insertmacro Expect "windows-root" "$WINDIR" "protected-path" 0 ""
  !insertmacro Expect "system-directory" "$SYSDIR" "protected-path" 0 ""
  !insertmacro Expect "program-files-64" "$PROGRAMFILES64" "protected-path" 0 ""
  !insertmacro Expect "program-files-32" "$PROGRAMFILES32" "protected-path" 0 ""
  !insertmacro Expect "windows-child" "$WINDIR\MD-Split-Validation-NoWrite" "windows-path" 0 ""
  !insertmacro Expect "unc-path" "\\invalid-server\share\MD Split" "network-path" 0 ""
  !insertmacro Expect "device-path" "\\?\C:\MD Split" "network-path" 0 ""
  !insertmacro Expect "empty-input" "" "invalid-path" 0 ""
  !insertmacro Expect "relative-input" "MD Split" "invalid-path" 0 ""
  !insertmacro Expect "drive-relative-input" "C:MD Split" "invalid-path" 0 ""
  !insertmacro Expect "forward-slash-input" "C:/MD Split" "invalid-path" 0 ""
  !insertmacro Expect "dot-dot-to-root" "$DriveRoot\MD-Split-Validation-NoWrite\.." "protected-path" 0 ""
  !insertmacro Expect "trailing-separator" "$FixtureRoot\empty\" "" 0 "$FixtureRoot\empty"
  !insertmacro Expect "dot-alias" "$FixtureRoot\empty\." "" 0 "$FixtureRoot\empty"
  !insertmacro Expect "unicode-and-space" "$FixtureRoot\日本語と space" "" 0 "$FixtureRoot\日本語と space"

  ; FixtureRoot came from GetTempFileName and is never reassigned or read from
  ; installer arguments. Validation of protected paths above is read-only.
  RMDir /r "$FixtureRoot"
  FileWrite $LogHandle "TOTAL passed=$ChecksPassed failed=$ChecksFailed$\r$\n"
  FileClose $LogHandle
  ${If} $ChecksFailed != 0
    SetErrorLevel 1
  ${Else}
    SetErrorLevel 0
  ${EndIf}
SectionEnd
