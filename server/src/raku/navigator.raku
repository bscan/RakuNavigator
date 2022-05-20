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
    $munged-source ~~ s:Perl5:g:m/(?<=^|;|})([ \t]*)BEGIN(?=\s)/{$0}ENTER/;
    $munged-source ~~ s:Perl5:g:m/(?<=^|;|})([ \t]*)CHECK(?=\s)/{$0}ENTER/;

    my $parsed = $g.parse(
        $munged-source,
        :p( 0 ),
        :actions( $a )
    );

    # Assuming the code can be parsed, then compile it too. Additional errors are available from the optimize level of checks.
    # TODO: This results in compiling twice and throws double warnings to STDERR How can I only compile once?
    note("90d0cb6c-4a53-427b-8d30-b1195895c2df\n");
    $compiler.compile($parsed);

    return $parsed;
}

my $parsed;


try {
    # Warnings are not always capture in @worries. How do we get those?
    $parsed = parse-code($code);
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

my $line_num = 0;
my $last_to = 0;
# Some lines are skipped, so you may need to match to the original.
for $parsed.hash.<statementlist>.hash.<statement>.list -> $k {
    #print $k.orig;
    #print substr( $k.orig, $k.from, $k.to - $k.from );
    my $missing = $k.from - $last_to;
    if ( $missing > 0 ) {
        # The parser excludes whitespace, so we need to add it back to keep the line count correct
        my $skipped = substr( $k.orig, $last_to, $missing );
        $line_num += $skipped.split("\n").elems() - 1;
    }
    $last_to = $k.to;
    my $subStr = $k.Str;
    my @lines = $subStr.split("\n");

    my $cleanContent = clean-content($subStr);

    my $var_continues = 0;

    match-constructs(@lines[0], $line_num, $cleanContent, $var_continues);
    
    loop (my $j = 1; $j < @lines.elems(); $j++) {
        # Intentionally Skip first line where definition is.
        match-constructs(@lines[$j], $line_num + $j, @lines[$j], $var_continues);
    }
    $line_num += @lines.elems() - 1;
}

sub clean-content($subStr) {
    # Strip trailing comments and whitespace for computing end of block line numbers
    if ($subStr ~~ m:P5:s/(.*})[^}]+$/) {
        return $0;
    } else {
        return $subStr;
    }
}

sub match-constructs ($stmt_in, $line_number, $content, $var_continues is rw) {

    my $end_line = $line_number + $content.split("\n").elems() - 1;
    my $stmt = $stmt_in;
    $stmt ~~ s/^\s*//;
    $stmt ~~ s/^\#.*//;
    $stmt ~~ s/\s*$//;
    if (!$stmt) {
        $var_continues = 0;
        return;
    } 


    if ($var_continues or $stmt ~~ m:P5/^(?:my|our|let|state)\b/) {

        $var_continues = ( $stmt !~~ m:P5/;/ and $stmt !~~ m:P5/[\)\=\}\x7b]/ );

        $stmt ~~ s/^(my|our|let|state)\s+//;
        $stmt ~~ s/\s*\=.*//;

        my @vars = ($stmt ~~ m:P5:g/([\$\@\%](?:[\w\-]|::)+)/); 

        for @vars -> $var {
            make-tag($var, "v", '', $file-path, $line_number);
        }

    } elsif   ($stmt ~~ m:P5/^multi\s+(?:(sub|method|submethod)\s+)?!?([\w\-]+)((?::[\w\-<>]+)?\s?\([^()]+\))/ # Grab signature for Multi-sub. 
                 or $stmt ~~ m:P5/^(sub|method|submethod)\s+!?([\w\-]+)(:[\w\-<>]+)?/) {
        # Captures multi-dispatch details and signature in $details for display in the outline, different from the symbol name itself

        my $subName = $1;
        my $kind = (!defined($0) or $0 eq 'sub') ?? 's' !! 'o';
        my $details = $2 // '';
        make-tag($subName, $kind, $details, $file-path, "$line_number;$end_line");
        
        $var_continues = ( $stmt !~~ m:P5/;/ and $stmt !~~ m:P5/[\)\=\}\x7b]/ );
        
        my @vars = ($stmt ~~ m:P5:g/([\$\@\%](?:[\w\-]|::)+)/); 
        for @vars -> $var {
            make-tag($var, "v", '',$file-path, $line_number);
        }

    } elsif ($stmt ~~ m:P5/^(?:my )?class\s+((?:[\w\-]|::)+)/) {
        my $class_name = $0;
        make-tag($class_name, 'a', '',$file-path, "$line_number;$end_line");
    } elsif ($stmt ~~ m:P5/^(?:my )?(?:proto )?role\s+([\w\-:<>]+)/) {
        my $role_name = $0;
        make-tag($role_name, 'b', '', $file-path, "$line_number;$end_line");
    } elsif ($stmt ~~ m:P5/^(?:my )?token\s+([\w\-]+)(:[\w\-<>]+)?/) {
        my $token_name = $0;
        my $details = $1 // '';
        make-tag($token_name, 't', $details, $file-path, "$line_number;$end_line");
    } elsif ($stmt ~~ m:P5/^(?:my )?rule\s+([\w\-]+)(:[\w\-<>]+)?/) {
        my $rule_name = $0;
        my $details = $1 // '';
        make-tag($rule_name, 'r', $details, $file-path, "$line_number;$end_line");
    } elsif ($stmt ~~ m:P5/^(?:my )?grammar\s+((?:[\w\-]|::)+)/) {
        my $grammar_name = $0;
        make-tag($grammar_name, 'g', '', $file-path, "$line_number;$end_line");
    } elsif ($stmt ~~ m:P5/^has\s+(?:\w+\s+)?([$@%][\.\!][\w-]+)(?:\s|;|)/) {
        my $attr = $0;
        make-tag($attr, 'f', '', $file-path, "$line_number;$end_line");
    } elsif ($stmt ~~ /^(BEGIN|CHECK|INIT|END)\s*\x7b/) {
        my $phaser = $0;
        # Exclude for now given the source munging.
        #make-tag($phaser, "e", '', $file-path, "$line_number;$end_line");
    }

    return;
    # TODO: object type detection
}

sub make-tag($subName, $kind, $details, $file-path, $lines){
    print "$subName\t$kind\t$details\t$file-path\t$lines\n";
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
