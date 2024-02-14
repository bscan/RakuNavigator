
# Loop through each repository in the repo-chain
for $*REPO.repo-chain -> $repo {
    try {
        # Check if the repository is a FileSystem or Installation repository
        next unless $repo ~~ CompUnit::Repository::FileSystem | CompUnit::Repository::Installation;

        # Based on the type of repository, decide what to push to @dists
        my $dist = $repo ~~ CompUnit::Repository::FileSystem 
                        ?? $repo.distribution 
                        !! $repo.installed.Slip;
        # Ensure what we're pushing is defined before adding it to @dists
        next unless ($dist.defined && $dist !=== Nil && $dist.grep(*.defined) );
        my @dists = |$dist; # $dist may be a Slip
        say "Inspecting: " ~ $repo.abspath;

        # (TWEAK writeable-path can-install name upgrade-repository install uninstall files candidates resolve need resource id short-id loaded distribution installed precomp-store precomp-repository load repo-chain new source-file WHICH Str gist raku next-repo prefix abspath path-spec BUILDALL)
        for @dists -> $dist {
            for $dist.meta.hash<provides>.kv -> $module, %details {
                # TODO: What happens if a module provides multiple files? I'm just grabbing the first one.

                my $base = $repo.abspath.IO;  # Convert the string to an IO::Path object
                my $full_path = $base.child("sources").child(%details.values[0]<file>);  # Join the paths. Is everything always in source?

                say "\tM\t$module\t$full_path\t";
            }
        }
    } 
    if $! {
        say "ERROR processing $repo: $! . Please report this issue on github"
    }
}


