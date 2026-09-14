package com.streamhouse.tv

import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.streamhouse.tv.databinding.ActivitySetupBinding

/**
 * Picks where StreamHouse runs: on this device, which needs nothing else, or
 * on a computer — found automatically, or typed in.
 */
class SetupActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySetupBinding
    private var found: List<Discovery.Server> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.address.setText(Prefs.server(this).takeIf { it != Prefs.THIS_DEVICE } ?: "")

        binding.thisDevice.setOnClickListener {
            Prefs.setServer(this, Prefs.THIS_DEVICE)
            finish()
        }
        binding.scan.setOnClickListener { scan() }
        binding.connect.setOnClickListener { connect(binding.address.text.toString()) }
        binding.servers.setOnItemClickListener { _, _, position, _ ->
            found.getOrNull(position)?.let { connect(it.url) }
        }

        scan()
    }

    private fun scan() {
        binding.status.text = getString(R.string.searching)
        binding.scan.isEnabled = false
        Discovery.find { servers ->
            binding.scan.isEnabled = true
            found = servers
            if (servers.isEmpty()) {
                binding.status.text = getString(R.string.none_found)
                binding.servers.visibility = View.GONE
                binding.address.requestFocus()
                return@find
            }
            binding.status.text = resources.getQuantityString(R.plurals.found, servers.size, servers.size)
            binding.servers.visibility = View.VISIBLE
            binding.servers.adapter = ArrayAdapter(
                this,
                android.R.layout.simple_list_item_1,
                servers.map { "${it.name}  —  ${it.url}" }
            )
            binding.servers.requestFocus()
        }
    }

    private fun connect(input: String) {
        val url = Prefs.normalize(input)
        if (url.isEmpty()) {
            Toast.makeText(this, R.string.enter_address, Toast.LENGTH_SHORT).show()
            return
        }
        Prefs.setServer(this, url)
        finish()
    }
}
