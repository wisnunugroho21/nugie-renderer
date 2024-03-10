#include "quads_terrain_mesh.hpp"

namespace NugieApp {
	void QuadTerrainMesh::convertPointsToMeshes(TerrainPoints* terrainPoints, float worldScale) {
		// float textureTerrainScale = static_cast<float>(floor(terrainPoints->getSize() / 100));

		for (uint32_t z = 0; z < terrainPoints->getSize() - 1; z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize() - 1; x++) {
				uint32_t indexBottomLeft = z * terrainPoints->getSize() + x;
				uint32_t indexTopLeft = (z + 1) * terrainPoints->getSize() + x;
				uint32_t indexTopRight = (z + 1) * terrainPoints->getSize() + x + 1;
				uint32_t indexBottomRight = z * terrainPoints->getSize() + x + 1;

				this->indices.emplace_back(indexBottomLeft);
				this->indices.emplace_back(indexBottomRight);
				this->indices.emplace_back(indexTopRight);
				this->indices.emplace_back(indexTopLeft);
			}
		}

		for (uint32_t z = 0; z < terrainPoints->getSize(); z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x++) {
				float y = terrainPoints->get(x, z);

				Vertex vertex{};
				vertex.position = glm::vec4 { x * worldScale, 0.0f, z * worldScale, 1.0f };

				this->vertices.emplace_back(vertex);
			}
		}

		for (uint32_t z = 0; z < terrainPoints->getSize(); z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x++) {
				float tSize = static_cast<float>(terrainPoints->getSize());

				NormText normText{};
				normText.textCoord = glm::vec2 { static_cast<float>(x) / tSize, static_cast<float>(z) / tSize };

				this->normTexts.emplace_back(normText);
			}
		}

		for (uint32_t i = 0; i < static_cast<uint32_t>(this->indices.size()); i += 4) {
			Patch patch;

			float xPos = 0.5f * (this->vertices[this->indices[0]].position.x + this->vertices[this->indices[1]].position.x);
			float zPos = 0.5f * (this->vertices[this->indices[0]].position.z + this->vertices[this->indices[3]].position.z);

			float xTextCoord = 0.5f * (this->normTexts[this->indices[0]].textCoord.x + this->normTexts[this->indices[1]].textCoord.x);
			float zTextCoord = 0.5f * (this->normTexts[this->indices[0]].textCoord.y + this->normTexts[this->indices[3]].textCoord.y);

			patch.position = glm::vec4{ xPos, 0.0f, zPos, 1.0f };
			patch.textCoord = glm::vec2{ xTextCoord, zTextCoord };

			this->patches.emplace_back(patch);
		}		
	}

	void QuadTerrainMesh::convertPointsToMeshes(TerrainPoints* terrainPoints, uint32_t patchSize, float worldScale) {
		// float textureTerrainScale = static_cast<float>(floor(terrainPoints->getSize() / 100));
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

		for (uint32_t i = 0; i < static_cast<uint32_t>(this->indices.size()); i += 4) {
			Patch patch;

			float xPos = 0.5f * (this->vertices[this->indices[0]].position.x + this->vertices[this->indices[1]].position.x);
			float zPos = 0.5f * (this->vertices[this->indices[0]].position.z + this->vertices[this->indices[3]].position.z);

			float xTextCoord = 0.5f * (this->normTexts[this->indices[0]].textCoord.x + this->normTexts[this->indices[1]].textCoord.x);
			float zTextCoord = 0.5f * (this->normTexts[this->indices[0]].textCoord.y + this->normTexts[this->indices[3]].textCoord.y);

			patch.position = glm::vec4{ xPos, 0.0f, zPos, 1.0f };
			patch.textCoord = glm::vec2{ xTextCoord, zTextCoord };

			this->patches.emplace_back(patch);
		}
	}
}