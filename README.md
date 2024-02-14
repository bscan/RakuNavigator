For those interested in a Perl 5 Language Server, check out https://marketplace.visualstudio.com/items?itemName=bscan.perlnavigator

# Raku Navigator

This is a Raku Extension for Visual Studio Code including a Language Server. Currently it provides
- Definition of Raku language and file associations
- Icon for Raku files
- Syntax Highlighting (thanks to https://github.com/Raku/atom-language-perl6)
- Snippets for simple loops and grammars 
- Language Server providing:
  - Syntax checking and warnings
  - Outline view and breadcrumbs
  - Autocompletion and go-to definition on local variables, grammars, and classes


Install the vscode extension from: https://marketplace.visualstudio.com/items?itemName=bscan.raku-navigator 

## Gif of Extension in Action

![Gif of Raku LSP](https://raw.githubusercontent.com/bscan/RakuNavigator/master/images/RakuLSP.gif)


## Other recommended settings
I also recommend the following vscode settings when using Raku.
The word separators are important for highlighting function names that have a hyphen in them, and for variables that include sigils.

<pre>
"[raku]": {
	"editor.wordSeparators": "`~!#^&*()=+[{]}\\|;:'\",.<>/?",
},
</pre>



## Configuration Settings

- raku.rakuPath specifies the location of your raku install. Defaults to "raku"
- raku.includePaths adds locations to the path via a -I command line switch
