For those interested in a Perl 5 Language Server, check out https://marketplace.visualstudio.com/items?itemName=bscan.perlnavigator

# Raku Navigator

This is a Raku Extension for Visual Studio Code including a Language Server. Currently it provides
- Definition of Raku language and file associations
- Icon for Raku files
- Syntax Highlighting (thanks to https://github.com/Raku/atom-language-perl6)
- Simple Language Server providing syntax checking and warnings
- Snippets for simple loops and grammars 

Install the vscode extension from: https://marketplace.visualstudio.com/items?itemName=bscan.raku-navigator 

## Screenshot

![Screenshot](https://raw.githubusercontent.com/bscan/RakuNavigator/master/images/RakuLang.png)


## Configuration Settings

- raku.rakuPath specifies the location of your raku install. Defaults to "raku"
- raku.includePaths adds locations to the path via a -I command line switch
