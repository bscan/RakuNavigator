#!/usr/bin/env raku

#| Main script to test language server features
use TestLib;

#| Example function to exercise language server features
#| - Multi candidates (no-arg and with args)
#| - Positional and named parameters with defaults
#| - Hover docs and signature help
multi sub greet() returns Str {
    'Hello, World'
}

multi sub greet(Str:D $name, :$excited = False, :$times = 1) returns Str {
    my $msg = "Hello, $name";
    $excited and $msg ~= '!';
    return ($msg xx $times).join(' ');
}

sub MAIN() {
    say "=== Raku Language Server Test ===";
    
    # Test 1: Class instantiation
    my $calc = Calculator.new;
    
    # Test 2: Method calls with parameters
    my $sum = $calc.add(10, 5);
    
    # Test 3: Function call
    say format-result($sum);
    
    # Test 4: Method call returning array
    my @history = $calc.get-history();
    
    # Test 5: Variable usage and iteration
    for @history -> $entry {
        say "History: $entry";
    }

    # Test 6: Local function calls (multi dispatch + named args)
    say greet();
    say greet("Raku", :excited, :times(2));
    
    say "=== Test Complete ===";
}
