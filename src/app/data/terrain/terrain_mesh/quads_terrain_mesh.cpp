#include "quads_terrain_mesh.hpp"

namespace NugieApp {
	void QuadTerrainMesh::convertPointsToMeshes(TerrainPoints* terrainPoints, float worldScale) {
		// float textureTerrainScale = static_cast<float>(floor(terrainPoints->getSize() / 100));

		uint32_t patchSize = 32;
		uint32_t patchCount = terrainPoints->getSize() / patchSize;

		for (uint32_t z = 0; z < patchCount - 1; z++) {
			for (uint32_t x = 0; x < patchCount - 1; x++) {
				uint32_t indexBottomLeft = z * patchCount + x;
				uint32_t indexTopLeft = (z + 1) * patchCount + x;
				uint32_t indexTopRight = (z + 1) * patchCount + x + 1;
				uint32_t indexBottomRight = z * patchCount + x + 1;

				this->indices.emplace_back(indexBottomLeft);
				this->indices.emplace_back(indexBottomRight);
				this->indices.emplace_back(indexTopRight);
				this->indices.emplace_back(indexTopLeft);
			}
		}

		for (uint32_t z = 0; z < terrainPoints->getSize(); z += patchSize) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x += patchSize) {
				float y = terrainPoints->get(x, z);

				Vertex vertex{};
				vertex.position = glm::vec4 { x * worldScale, 0.0f, z * worldScale, 1.0f };

				this->vertices.emplace_back(vertex);
			}
		}

		for (uint32_t z = 0; z < terrainPoints->getSize(); z += patchSize) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x += patchSize) {
				float tSize = static_cast<float>(terrainPoints->getSize());

				NormText normText{};
				normText.textCoord = glm::vec2 { static_cast<float>(x) / tSize, static_cast<float>(z) / tSize };

				this->normTexts.emplace_back(normText);
			}
		}		
	}
}