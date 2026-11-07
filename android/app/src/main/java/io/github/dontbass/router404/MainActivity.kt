package io.github.dontbass.router404

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var host: EditText
    private lateinit var token: EditText
    private lateinit var state: TextView
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        host = findViewById(R.id.host)
        token = findViewById(R.id.token)
        state = findViewById(R.id.state)

        host.setText(Config.host(this).removePrefix("http://"))
        token.setText(Config.token(this))

        findViewById<Button>(R.id.save).setOnClickListener { saveAndCheck() }
        findViewById<Button>(R.id.pin).setOnClickListener { pinWidget() }
        findViewById<Button>(R.id.open).setOnClickListener {
            if (!Config.configured(this)) {
                Toast.makeText(this, "Сначала адрес и ключ", Toast.LENGTH_SHORT).show()
            } else {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Config.appUrl(this, Repo.last(this)))))
            }
        }

        handleLink(intent)
        showLast()
        if (Config.configured(this)) check()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    /** router404://setup?h=192.168.88.1&t=<key> from the router's phone app page */
    private fun handleLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "router404") return
        val h = data.getQueryParameter("h").orEmpty()
        val t = data.getQueryParameter("t").orEmpty()
        if (h.isEmpty() || !Regex("^[0-9a-fA-F]{32}$").matches(t)) {
            state.text = "Ссылка без адреса или ключа"
            return
        }
        host.setText(h)
        token.setText(t)
        saveAndCheck()
    }

    private fun saveAndCheck() {
        val h = host.text.toString().trim()
        val t = token.text.toString().trim()
        if (h.isEmpty()) { state.text = "Укажите адрес роутера, например 192.168.88.1"; return }
        if (!Regex("^[0-9a-fA-F]{32}$").matches(t)) { state.text = "Ключ — 32 символа: цифры и буквы a–f"; return }
        Config.save(this, h, t)
        check()
    }

    private fun check() {
        state.text = "Спрашиваем роутер…"
        val app = applicationContext
        Thread {
            val ok = Repo.refresh(app)
            Renderer.pushAll(app)
            main.post {
                if (ok) showLast() else state.text = (Config.error(app) ?: "Нет ответа") +
                    "\n\nТелефон должен быть в Wi-Fi роутера, адрес — как в браузере (192.168.88.1)."
            }
        }.start()
    }

    private fun showLast() {
        val s = Repo.last(this) ?: return
        val lines = mutableListOf<String>()
        lines += (if (s.online) "● Интернет есть" else "● Нет интернета") + (s.ping?.let { "  $it мс" } ?: "")
        if (s.proxyInstalled)
            lines += if (!s.proxyRunning) "  Прокси выключен" else "${Flags.of(s.node)} ${Flags.bare(s.node)}" + (s.delay?.takeIf { it > 0 }?.let { "  $it мс" } ?: "")
        if (s.cellPresent)
            lines += "▂▄▆█ ${s.rsrp ?: "—"} дБм  " + listOfNotNull(s.operator, s.combo).joinToString(" · ")
        lines += ""
        lines += "Роутер ${s.host ?: ""} отвечает. Добавьте виджет на экран."
        state.text = lines.joinToString("\n")
    }

    private fun pinWidget() {
        val mgr = getSystemService(AppWidgetManager::class.java)
        if (mgr != null && mgr.isRequestPinAppWidgetSupported) {
            mgr.requestPinAppWidget(ComponentName(this, RouterWidget::class.java), null, null)
        } else {
            Toast.makeText(this, "Долгое нажатие на рабочем столе → Виджеты → Роутер", Toast.LENGTH_LONG).show()
        }
    }
}
