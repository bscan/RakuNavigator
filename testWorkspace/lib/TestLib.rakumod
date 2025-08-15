#| Simple test module for language server features
unit module TestLib;

#| A basic class for testing
class Calculator is export {
    #| Store results
    has @.history;

    #| Add two numbers
    method add($a, $b) {
        my $result = $a + $b;
        @.history.push("$a + $b = $result");
        return $result;
    }

    #| Get calculation history
    method get-history() {
        return @.history;
    }
}

#| Utility function for formatting
sub format-result($value) is export {
    return "Result: $value";
}
