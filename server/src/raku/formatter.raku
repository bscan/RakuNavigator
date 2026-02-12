#!/usr/bin/env raku
# Basic Raku code formatter
# This provides simple indentation and whitespace formatting

use v6;

sub MAIN(Int :$indent-size = 4, Bool :$use-tabs = False) {
    my $code = $*IN.slurp;
    my $formatted = format-code($code, $indent-size, $use-tabs);
    print $formatted;
}

sub format-code(Str $code, Int $indent-size, Bool $use-tabs --> Str) {
    my @lines = $code.lines;
    my @formatted;
    my $indent-level = 0;
    my $in-heredoc = False;
    my $heredoc-delimiter = '';

    for @lines -> $line {
        # Handle heredocs - don't format inside them
        if $in-heredoc {
            @formatted.push($line);
            if $line.trim eq $heredoc-delimiter {
                $in-heredoc = False;
                $heredoc-delimiter = '';
            }
            next;
        }

        # Check for heredoc start
        if $line ~~ /':to' \s* '/' (<-[/]>+) '/'/ {
            $heredoc-delimiter = ~$0;
            $in-heredoc = True;
            @formatted.push(format-line($line, $indent-level, $indent-size, $use-tabs));
            next;
        }

        # Skip empty lines and comments at the start
        if $line.trim eq '' {
            @formatted.push('');
            next;
        }

        # Skip POD blocks
        if $line.starts-with('=') {
            @formatted.push($line);
            next;
        }

        # Decrease indent for closing braces at the start of line
        my $trim-line = $line.trim;
        if $trim-line.starts-with(any('}', ']', ')')) {
            $indent-level-- if $indent-level > 0;
        }

        # Format the line with current indentation
        my $formatted-line = format-line($line, $indent-level, $indent-size, $use-tabs);
        @formatted.push($formatted-line);

        # Increase indent for opening braces at end of line
        if $trim-line.ends-with(any('{', '[', '(')) ||
           $trim-line ~~ /^ \s* ('sub'|'method'|'class'|'role'|'grammar'|'rule'|'token'|'regex') \s/ {
            $indent-level++ if $trim-line.ends-with('{');
        }

        # Handle opening braces in the middle followed by more code
        my $open-count = $trim-line.comb('{').elems + $trim-line.comb('[').elems + $trim-line.comb('(').elems;
        my $close-count = $trim-line.comb('}').elems + $trim-line.comb(']').elems + $trim-line.comb(')').elems;

        # Adjust indent level based on net brace count
        if $open-count > $close-count {
            $indent-level += ($open-count - $close-count);
        }
    }

    return @formatted.join("\n") ~ "\n";
}

sub format-line(Str $line, Int $indent-level, Int $indent-size, Bool $use-tabs --> Str) {
    my $trimmed = $line.trim;
    return '' if $trimmed eq '';

    my $indent-str;
    if $use-tabs {
        $indent-str = "\t" x $indent-level;
    } else {
        $indent-str = ' ' x ($indent-level * $indent-size);
    }

    return $indent-str ~ $trimmed;
}
