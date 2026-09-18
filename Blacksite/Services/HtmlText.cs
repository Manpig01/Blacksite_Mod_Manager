using System.Text;

namespace Blacksite.Services;

/// <summary>
/// Minimal HTML → plain-text conversion for real sp-mod.com release notes (the versions API returns
/// HTML in its description field). Block tags become line breaks, all other tags are stripped, and
/// the common entities are decoded — good enough to render changelogs readably without a browser.
/// </summary>
public static class HtmlText
{
    public static string ToPlainText(string? html, int maxLines = 400)
    {
        if (string.IsNullOrWhiteSpace(html)) return string.Empty;

        var sb = new StringBuilder(html.Length);
        int i = 0;
        while (i < html.Length)
        {
            char c = html[i];
            if (c != '<')
            {
                sb.Append(c);
                i++;
                continue;
            }

            int close = html.IndexOf('>', i + 1);
            if (close < 0) break; // malformed tail — drop it

            string tag = html[(i + 1)..close].Trim().TrimEnd('/').ToLowerInvariant();
            bool isBlock = tag is "p" or "div" or "br" or "li" or "ul" or "ol" or "tr"
                or "h1" or "h2" or "h3" or "h4" or "h5" or "h6" or "blockquote" or "pre" or "table";
            bool closesBlock = tag.StartsWith('/') && tag.Length > 1 &&
                tag[1..] is "p" or "div" or "li" or "ul" or "ol" or "tr" or "h1" or "h2" or "h3"
                    or "h4" or "h5" or "h6" or "blockquote" or "pre" or "table";
            if (tag == "br" || (isBlock && !tag.StartsWith('/')) || closesBlock)
                sb.Append('\n');

            i = close + 1;
        }

        string text = DecodeEntities(sb.ToString());

        // Normalize whitespace: trim line ends, collapse 3+ blank lines, drop the leading blank.
        var lines = text.Split('\n').Select(l => l.Trim()).ToList();
        var result = new StringBuilder();
        int blanks = 0;
        int kept = 0;
        foreach (string line in lines)
        {
            if (line.Length == 0)
            {
                blanks++;
                continue;
            }
            if (blanks > 0 && result.Length > 0) result.Append('\n'); // one blank line between paragraphs
            blanks = 0;
            result.AppendLine(line);
            if (++kept >= maxLines) break;
        }
        return result.ToString().Trim();
    }

    private static string DecodeEntities(string s) => s
        .Replace("&nbsp;", " ", StringComparison.OrdinalIgnoreCase)
        .Replace("&amp;", "&", StringComparison.OrdinalIgnoreCase)
        .Replace("&lt;", "<", StringComparison.OrdinalIgnoreCase)
        .Replace("&gt;", ">", StringComparison.OrdinalIgnoreCase)
        .Replace("&quot;", "\"", StringComparison.OrdinalIgnoreCase)
        .Replace("&#39;", "'", StringComparison.OrdinalIgnoreCase)
        .Replace("&apos;", "'", StringComparison.OrdinalIgnoreCase)
        .Replace("&hellip;", "…", StringComparison.OrdinalIgnoreCase)
        .Replace("&mdash;", "—", StringComparison.OrdinalIgnoreCase)
        .Replace("&ndash;", "–", StringComparison.OrdinalIgnoreCase);
}
