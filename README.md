# Raku Navigator

This is the source code for the Visual Studio Code Raku Extension with Language Server. Currently it provides
- Definition of Raku language and file associations
- Icon for Raku files
- Syntax Highlighting (thanks to https://github.com/Raku/atom-language-perl6)
- Simple Language Server providing syntax checking

## Screenshot

![Screenshot](https://raw.githubusercontent.com/bscan/RakuNavigator/master/images/RakuExt.png)


## Configuration Settings

- raku.rakuPath specifies the location of your raku install. Defaults to "raku"
- raku.includePaths adds locations to the path via a -I command line switch
