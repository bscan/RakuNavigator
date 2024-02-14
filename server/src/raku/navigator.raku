use nqp;
use QAST:from<NQP>;

say "Running navigator.raku";

my $code = $*IN.slurp;
my $file-path = @*ARGS[0];
say "Received file: $file-path\n";


sub parse-code( Str $source ) {
    # Parsing logic from https://github.com/Raku/Raku-Parser/blob/master/lib/Perl6/Parser.pm6

    my $*LINEPOSCACHE;
    
    my $compiler := nqp::getcomp('perl6');

    if (!$compiler) {
        $compiler := nqp::getcomp('Raku');
    }

    my $g := nqp::findmethod(
        $compiler,'parsegrammar'
    )($compiler);

    my $a := nqp::findmethod(
        $compiler,'parseactions'
    )($compiler);

    my $munged-source = $source;
    # Replace BEGIN/CHECK blocks, but only if they start the line or follow a semicolon
    # This will mess with the phaser list in the outline. 
    $munged-source ~~ s:Perl5:g:m:sigspace/((?:^|;|})[ \t]*)BEGIN(?=\s)/{$0}ENTER/;
    $munged-source ~~ s:Perl5:g:m:sigspace/((?:^|;|})[ \t]*)CHECK(?=\s)/{$0}ENTER/;

    my $parsed = $g.parse(
        $munged-source,
        :p( 0 ),
        :actions( $a )
    );

    # TODO: Now that we don't need the parsed result, can we jump straight to compling?
    # Assuming the code can be parsed, then compile it too. Additional errors are available from the optimize level of checks.
    # TODO: This results in compiling twice and throws double warnings to STDERR How can I only compile once?
    note("90d0cb6c-4a53-427b-8d30-b1195895c2df\n");
    $compiler.compile($parsed);

    return $parsed;
}

my $parsed;


try {
    # Warnings are not always capture in @worries. How do we get those?
    parse-code($code);
}

if ($!) {
    # We check a number of fields hunting for the error
    # If we can't find it, we'll drop the gist of $! back at the first line
    my $bFoundError = 0; 

    if ($!.can('sorrows')) {
        $bFoundError = 1;
        for $!.sorrows -> $sorrow {
            format-exc($sorrow, 1);
        }
    }

    if ($!.can('panic')) {
        $bFoundError = 1;
        format-exc($!.panic, 1);
    }

    if ($!.can('worries')) {
        $bFoundError = 1;
        for $!.worries -> $worry {
            format-exc($worry, 0);
        }
    }

    if ($!.can('message') and $!.can('line')) {
        $bFoundError = 1;
        print-exc($!.message, $!.line, 1);
    }
    
    if ($bFoundError == 0) {
        say "Could not figure out the error structure of" ~ $!.WHO;
        my $message = $!.gist();
        print-exc($message, 0, 1);
    }
    say "~||~"; # Terminate final exception. Probably not needed
    exit(1);
}



sub format-exc ($exc, $level) {
    if ($exc.can('message') and $exc.can('line') ) { # and $exc.can('filename')
        print-exc($exc.message, $exc.line, $level);
    } else {
        my $message = $exc.gist();
        print-exc($message, 0, $level);
    }
}

sub print-exc($message, $line, $level) {
    my $resolvedLine = $line;

    # Errors from some types appear to be located at the wrong spots, or I didn't find the correct attribute for $line
    if $message ~~ m:s/used at lines? (\d+)/ {
        $resolvedLine = $0;
    }
    if $message ~~ m:s/Could not find \S+ at line (\d+) in/ {
        $resolvedLine = $0;
    }

    say "~||~" ~ $resolvedLine ~ "~|~" ~ $level ~ "~|~" ~ $message;
}

# TODO: Figure out how to make symbol table parsing work
# for ::.kv -> $k, $v {
#     if ($k.starts-with('&')) {
#         make-tag($k, "s", $v.signature.gist(), $v.file, $v.line );
#     }
# }
