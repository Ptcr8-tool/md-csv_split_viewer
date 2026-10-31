!ifndef MD_SPLIT_DIRECTORY_VALIDATION_NSH
!define MD_SPLIT_DIRECTORY_VALIDATION_NSH

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!ifndef PRODUCT_ID
  !error "Define PRODUCT_ID before including DirectoryValidation.nsh"
!endif

Var DirectoryError
Var ExistingOwned

; Read-only validation. Input: $INSTDIR. Outputs: $DirectoryError (empty on
; success), $ExistingOwned (0/1), and a canonical $INSTDIR after normalization.
; A normalization failure preserves the input. Registers $0 through $9 are scratch.
; Error codes: invalid-path, network-path, protected-path, windows-path,
; reparse-point, target-file, access-error, directory-not-empty.
Function CheckInstallDirectory
  StrCpy $DirectoryError ""
  StrCpy $ExistingOwned 0
  ${If} $INSTDIR == ""
    StrCpy $DirectoryError "invalid-path"
    Return
  ${EndIf}

  ; Only drive-absolute local paths are accepted. Reject network/device syntax
  ; before normalization so it cannot become an apparently local path.
  StrCpy $0 $INSTDIR 2
  ${If} $0 == "\\"
  ${OrIf} $0 == "//"
  ${OrIf} $0 == "\/"
  ${OrIf} $0 == "/\"
    StrCpy $DirectoryError "network-path"
    Return
  ${EndIf}
  StrCpy $0 $INSTDIR 1 1
  ${If} $0 != ":"
    StrCpy $DirectoryError "invalid-path"
    Return
  ${EndIf}
  ; $INSTDIR is an NSIS special variable whose value may lose a trailing
  ; backslash: an assigned drive root such as C:\ can arrive as C:.
  ; Reject that representation as a protected root, never as a destination.
  StrLen $2 $INSTDIR
  ${If} $2 == 2
    StrCpy $0 $INSTDIR 1
    StrCpy $1 "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    StrCpy $2 0
    check_root_drive_letter:
      StrCpy $3 $1 1 $2
      StrCmp $0 $3 protected_drive_root
      IntOp $2 $2 + 1
      IntCmp $2 26 invalid_root_drive_letter check_root_drive_letter invalid_root_drive_letter
    protected_drive_root:
      StrCpy $DirectoryError "protected-path"
      Return
    invalid_root_drive_letter:
      StrCpy $DirectoryError "invalid-path"
      Return
  ${EndIf}
  StrCpy $1 $INSTDIR 1 2
  ${If} $1 != "\"
    StrCpy $DirectoryError "invalid-path"
    Return
  ${EndIf}
  ; Keep one separator form throughout normalization and parent traversal.
  StrLen $1 $INSTDIR
  StrCpy $2 0
  check_directory_separator:
    StrCpy $0 $INSTDIR 1 $2
    ${If} $0 == "/"
      StrCpy $DirectoryError "invalid-path"
      Return
    ${EndIf}
    IntOp $2 $2 + 1
    IntCmp $2 $1 directory_separators_valid check_directory_separator directory_separators_valid
  directory_separators_valid:
  StrCpy $0 $INSTDIR 1
  StrCpy $1 "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  StrCpy $2 0
  check_drive_letter:
    StrCpy $3 $1 1 $2
    StrCmp $0 $3 drive_letter_valid
    IntOp $2 $2 + 1
    IntCmp $2 26 invalid_drive_letter check_drive_letter invalid_drive_letter
  invalid_drive_letter:
    StrCpy $DirectoryError "invalid-path"
    Return
  drive_letter_valid:

  ; NSIS GetFullPathName requires the target to exist. Win32 normalization does
  ; not, so a new dedicated installation folder remains a valid destination.
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0)i.r1'
  ${If} $1 == 0
  ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
  ${OrIf} $0 == ""
    StrCpy $DirectoryError "invalid-path"
    Return
  ${EndIf}
  trim_directory_separator:
    StrLen $1 $0
    ${If} $1 > 3
      StrCpy $2 $0 1 -1
      ${If} $2 == "\"
      ${OrIf} $2 == "/"
        StrCpy $0 $0 -1
        Goto trim_directory_separator
      ${EndIf}
    ${EndIf}
  StrCpy $INSTDIR $0

  ${GetRoot} "$INSTDIR" $9
  ${If} $INSTDIR == "$9\"
  ${OrIf} $INSTDIR == "$9"
  ${OrIf} $INSTDIR == "$PROFILE"
  ${OrIf} $INSTDIR == "$LOCALAPPDATA"
  ${OrIf} $INSTDIR == "$PROGRAMFILES64"
  ${OrIf} $INSTDIR == "$PROGRAMFILES32"
  ${OrIf} $INSTDIR == "$WINDIR"
  ${OrIf} $INSTDIR == "$SYSDIR"
    StrCpy $DirectoryError "protected-path"
    Return
  ${EndIf}
  StrLen $0 "$WINDIR\"
  StrCpy $1 "$INSTDIR\" $0
  ${If} $1 == "$WINDIR\"
    StrCpy $DirectoryError "windows-path"
    Return
  ${EndIf}

  ; Reject reparse points in every existing ancestor. Only missing-path errors
  ; may be skipped; access failures and a file in the path fail closed.
  StrCpy $8 -1
  StrCpy $1 $INSTDIR
  check_directory_ancestor:
    System::Call 'kernel32::GetFileAttributesW(w r1)i.r2 ?e'
    Pop $3
    ${If} $1 == $INSTDIR
      StrCpy $8 $2
    ${EndIf}
    ${If} $2 == -1
      ${If} $3 != 2
      ${AndIf} $3 != 3
        StrCpy $DirectoryError "access-error"
        Return
      ${EndIf}
      ${If} $1 == "$9\"
      ${OrIf} $1 == "$9"
        StrCpy $DirectoryError "access-error"
        Return
      ${EndIf}
    ${Else}
      IntOp $3 $2 & 0x400
      ${If} $3 != 0
        StrCpy $DirectoryError "reparse-point"
        Return
      ${EndIf}
      IntOp $3 $2 & 0x10
      ${If} $3 == 0
        StrCpy $DirectoryError "target-file"
        Return
      ${EndIf}
    ${EndIf}
    ${If} $1 == "$9\"
    ${OrIf} $1 == "$9"
      Goto directory_ancestors_checked
    ${EndIf}
    ${GetParent} "$1" $2
    ${If} $2 == $1
    ${OrIf} $2 == ""
      StrCpy $DirectoryError "access-error"
      Return
    ${EndIf}
    StrCpy $1 $2
    Goto check_directory_ancestor

  directory_ancestors_checked:
  ${If} $8 == -1
    Return
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\install.ini" "MD Split" "ProductId"
  ${If} $0 == "${PRODUCT_ID}"
    StrCpy $ExistingOwned 1
    Return
  ${ElseIf} ${FileExists} "$INSTDIR\MD-Split.exe"
  ${AndIf} ${FileExists} "$INSTDIR\MD-Split.dll"
  ${AndIf} ${FileExists} "$INSTDIR\wwwroot\index.html"
    ; Previous ZIP installations did not have install.ini.
    StrCpy $ExistingOwned 1
    Return
  ${EndIf}

  ; Enumerate real entries, including hidden files and subdirectories. Capture
  ; each API error in the same System call: a separate GetLastError call can
  ; lose the original error while the plug-in dispatches the call.
  ; WIN32_FIND_DATAW: 44-byte fixed fields, 260 WCHAR name, 14 WCHAR short name.
  System::Alloc 592
  Pop $5
  ${If} $5 = 0
    StrCpy $DirectoryError "access-error"
    Return
  ${EndIf}
  System::Call 'kernel32::FindFirstFileW(w "$INSTDIR\*", p r5)p.r6 ?e'
  Pop $0
  ${If} $6 = -1
    System::Free $5
    ${If} $0 != 2
      StrCpy $DirectoryError "access-error"
    ${EndIf}
    Return
  ${EndIf}
  check_directory_entry:
    System::Call '*$5(i,i,i,i,i,i,i,i,i,i,i,&w260 .r7)'
    StrCmp $7 "." next_directory_entry
    StrCmp $7 ".." next_directory_entry
    System::Call 'kernel32::FindClose(p r6)'
    System::Free $5
    StrCpy $DirectoryError "directory-not-empty"
    Return
  next_directory_entry:
    System::Call 'kernel32::FindNextFileW(p r6, p r5)i.r0 ?e'
    Pop $4
    ${If} $0 != 0
      Goto check_directory_entry
    ${EndIf}
    System::Call 'kernel32::FindClose(p r6)'
    System::Free $5
    ${If} $4 != 18
      StrCpy $DirectoryError "access-error"
    ${EndIf}
FunctionEnd

!endif
