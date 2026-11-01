' Menjalankan helper backup listrik tanpa jendela.
' Dipakai oleh: auto-start Windows (shortcut Startup) dan protokol backup-listrik://milai
Option Explicit

Dim fso, shell, folder, logFile, perintah
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

folder = fso.GetParentFolderName(WScript.ScriptFullName)
logFile = folder & "\uji\helper-otomatis.log"

If Not fso.FolderExists(folder & "\uji") Then
  fso.CreateFolder folder & "\uji"
End If

perintah = "cmd /c cd /d """ & folder & """ && node server-backup.js >> """ & logFile & """ 2>&1"
shell.Run perintah, 0, False
