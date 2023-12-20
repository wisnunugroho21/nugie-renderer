#include "load_terrain.hpp"

#include <stdexcept>
#include <sys/stat.h>

#ifdef _WIN32
#include <string.h>
#endif

namespace NugieApp {
  LoadedTerrain loadTerrain(const char* filePath) {
		LoadedTerrain loadedTerrain{};
		int fileSize = 0;

    unsigned char* p = (unsigned char*)ReadBinaryFile(filePath, fileSize);
		int terrainSize = static_cast<int>(sqrtf(static_cast<float>(fileSize) / sizeof(float)));

		loadedTerrain.positions.clear();
		loadedTerrain.indices.clear();

		for (int z = 0; z < terrainSize; z++) {
			for (int x = 0; x < terrainSize; x++) {
				float y = static_cast<float>(p[x + terrainSize * z]);

				Position position{};
				position.position = glm::vec4 { x, y, z, 1.0f };

				loadedTerrain.positions.emplace_back(position);
			}
		}

		for (int z = 0; z < terrainSize - 1; z++) {
			for (int x = 0; x < terrainSize - 1; x++) {
				uint32_t indexBottomLeft = z * terrainSize + x;
				uint32_t indexTopLeft = (z + 1) * terrainSize + x;
				uint32_t indexTopRight = (z + 1) * terrainSize + x + 1;
				uint32_t indexBottomRight = z * terrainSize + x + 1;

				loadedTerrain.indices.emplace_back(indexBottomLeft);
				loadedTerrain.indices.emplace_back(indexTopLeft);
				loadedTerrain.indices.emplace_back(indexTopRight);

				loadedTerrain.indices.emplace_back(indexBottomLeft);
				loadedTerrain.indices.emplace_back(indexTopRight);
				loadedTerrain.indices.emplace_back(indexBottomRight);
			}
		}
		
		return loadedTerrain;
  }

	#ifdef _WIN32
	char* ReadBinaryFile(const char* pFilename, int& size)
	{
		FILE* f = NULL;

		errno_t err = fopen_s(&f, pFilename, "rb");

		if (!f) {
			char buf[256] = { 0 };
			strerror_s(buf, sizeof(buf), err);
			throw std::runtime_error("Error opening file");
			exit(0);
		}

		struct stat stat_buf;
		int error = stat(pFilename, &stat_buf);

		if (error) {
			char buf[256] = { 0 };
			strerror_s(buf, sizeof(buf), err);
			throw std::runtime_error("Error getting file");
			return NULL;
		}

		size = stat_buf.st_size;

		char* p = (char*)malloc(size);
		assert(p);

		size_t bytes_read = fread(p, 1, size, f);

		if (bytes_read != size) {
			char buf[256] = { 0 };
			strerror_s(buf, sizeof(buf), err);
			throw std::runtime_error("Read file error");
			exit(0);
		}

		fclose(f);

		return p;
	}

	#else
	char* ReadBinaryFile(const char* pFilename, int& size)
	{
		FILE* f = fopen(pFilename, "rb");

		if (!f) {
			throw std::runtime_error("Error opening file");
			exit(0);
		}

		struct stat stat_buf;
		int error = stat(pFilename, &stat_buf);

		if (error) {
			throw std::runtime_error("Error getting file");
			return NULL;
		}

		size = stat_buf.st_size;

		char* p = (char*)malloc(size);
		assert(p);

		size_t bytes_read = fread(p, 1, size, f);

		if (bytes_read != size) {
			throw std::runtime_error("Read file error");
			exit(0);
		}

		fclose(f);

		return p;
	}
	#endif
}