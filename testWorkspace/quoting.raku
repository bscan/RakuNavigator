# This file is extracted from https://github.com/finanalyst/rakuast-rakudoc-render/blob/main/lib/RakuDoc/To/HTML.rakumod
# Aimed to verify the parsing for quoting

class Test
{
  my $a = qw｢ &lt; &gt; &amp; & " > < ｣ => qw｢ &lt; &gt; &amp; &amp; &quot; &gt; &lt;｣;

  method test() {}
}
