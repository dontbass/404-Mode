package io.github.dontbass.router404

/** A country flag for a proxy node: an emoji already in its name, or the country it names. */
object Flags {
    private val NAMES = linkedMapOf(
        "FI" to "финлянд|finland|helsinki|хельсинк", "SE" to "швец|sweden|stockholm", "NO" to "норвег|norway|oslo",
        "DK" to "дани|denmark", "NL" to "нидерланд|голланд|netherlands|amsterdam|амстердам",
        "DE" to "герман|germany|frankfurt|франкфурт|berlin", "RU" to "росси|russia|moscow|москв",
        "EE" to "эстон|estonia|tallinn", "LT" to "литв|lithuania", "LV" to "латв|latvia|riga",
        "AT" to "австри|austria|vienna", "HU" to "венгр|hungary", "BG" to "болгар|bulgaria", "AM" to "армен|armenia",
        "FR" to "франц|france|paris", "IT" to "итал|italy|milan", "IE" to "ирланд|ireland", "BE" to "бельги|belgium",
        "RO" to "румын|romania", "MD" to "молдов|moldova", "PL" to "польш|poland|warsaw", "UA" to "украин|ukrain",
        "JP" to "япон|japan|tokyo", "CH" to "швейцар|switzerland|zurich", "TR" to "турц|turkey|türkiye|istanbul|стамбул",
        "KZ" to "казах|kazakh|almaty|алмат", "US" to "сша|америк|usa|united states|new york",
        "GB" to "британ|англи|britain|england|united kingdom|london|лондон", "CA" to "канад|canada|toronto",
        "SG" to "сингапур|singapore", "HK" to "гонконг|hong kong", "CZ" to "чехи|czech|prague", "ES" to "испан|spain|madrid",
        "GE" to "грузи|georgia|tbilisi", "AE" to "оаэ|эмират|emirates|dubai|дубай", "BY" to "беларус|белорус|belarus|minsk",
        "RS" to "серби|serbia|belgrade"
    ).mapValues { Regex(it.value) }

    private val REGIONAL = Regex("[\\x{1F1E6}-\\x{1F1FF}]{2}")

    fun of(name: String?): String {
        if (name.isNullOrEmpty()) return ""
        REGIONAL.find(name)?.let { return it.value }
        val low = name.lowercase()
        for ((cc, re) in NAMES)
            if (re.containsMatchIn(low)) return emoji(cc)
        return ""
    }

    /** the name without its flag emoji */
    fun bare(name: String?): String = name?.replace(REGIONAL, "")?.trim()?.ifEmpty { name } ?: ""

    private fun emoji(cc: String): String {
        val sb = StringBuilder()
        for (c in cc) sb.appendCodePoint(0x1F1E6 + (c - 'A'))
        return sb.toString()
    }
}
