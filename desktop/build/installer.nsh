; Windows ekran koruyucusu: "TimayPlatform.scr" (kaynak: scr/TimayPlatform.cs, scripts/build-scr.mjs ile derlenir).
!include x64.nsh

!macro customInstall
  ; Ekran koruyucu Timay.exe'yi buradan bulur.
  WriteRegStr SHELL_CONTEXT "Software\TimayPlatform" "Exe" "$INSTDIR\Timay.exe"
  SetRegView 64
  WriteRegStr SHELL_CONTEXT "Software\TimayPlatform" "Exe" "$INSTDIR\Timay.exe"
  SetRegView 32
  !if /FileExists "${BUILD_RESOURCES_DIR}\TimayPlatform.scr"
    File "/oname=$INSTDIR\TimayPlatform.scr" "${BUILD_RESOURCES_DIR}\TimayPlatform.scr"
    ; Windows ekran koruyucu listesi System32'deki .scr dosyalarını gösterir (yalnız yönetici kurulumunda yazılabilir).
    ClearErrors
    ${DisableX64FSRedirection}
    CopyFiles /SILENT "$INSTDIR\TimayPlatform.scr" "$WINDIR\System32\TimayPlatform.scr"
    ${EnableX64FSRedirection}
    ClearErrors
  !endif
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${DisableX64FSRedirection}
    Delete "$WINDIR\System32\TimayPlatform.scr"
    ${EnableX64FSRedirection}
    DeleteRegKey SHELL_CONTEXT "Software\TimayPlatform"
    SetRegView 64
    DeleteRegKey SHELL_CONTEXT "Software\TimayPlatform"
    SetRegView 32
  ${endIf}
!macroend
