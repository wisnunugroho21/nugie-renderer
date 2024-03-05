#include "terrain_mesh.hpp"

namespace NugieApp {
	TerrainMesh::TerrainMesh(TerrainPoints* terrainPoints, float worldScale) : terrainPoints{terrainPoints}, worldScale{worldScale} {}

	void TerrainMesh::initialize() {
		this->generateIndices(this->terrainPoints, this->worldScale);
		this->generateVertices(this->terrainPoints, this->worldScale);
		this->generateTextureCoordinates(terrainPoints, this->worldScale);
		this->generateNormals(this->terrainPoints, this->worldScale);
	}

	void TerrainMesh::addTriangle(uint32_t index0, uint32_t index1, uint32_t index2) {
		this->indices.emplace_back(index0);
		this->indices.emplace_back(index1);
		this->indices.emplace_back(index2);
	}

	void TerrainMesh::generateIndices(TerrainPoints* terrainPoints, float worldScale) {
		for (uint32_t z = 0; z < terrainPoints->getSize() - 1; z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize() - 1; x++) {
				uint32_t indexBottomLeft = z * terrainPoints->getSize() + x;
				uint32_t indexTopLeft = (z + 1) * terrainPoints->getSize() + x;
				uint32_t indexTopRight = (z + 1) * terrainPoints->getSize() + x + 1;
				uint32_t indexBottomRight = z * terrainPoints->getSize() + x + 1;

				this->addTriangle(indexBottomLeft, indexTopLeft, indexTopRight);
				this->addTriangle(indexBottomLeft, indexTopRight, indexBottomRight);
			}
		}
	}

	void TerrainMesh::generateVertices(TerrainPoints* terrainPoints, float worldScale) {
		for (uint32_t z = 0; z < terrainPoints->getSize(); z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x++) {
				float y = terrainPoints->get(x, z);

				Vertex vertex{};
				vertex.position = glm::vec4 { x * worldScale, y * -1.0f, z * worldScale, 1.0f };

				this->vertices.emplace_back(vertex);
			}
		}
	}

	void TerrainMesh::generateTextureCoordinates(TerrainPoints* terrainPoints, float worldScale) {
		float textureTerrainScale = static_cast<float>(floor(terrainPoints->getSize() / 100));
		
		for (uint32_t z = 0; z < terrainPoints->getSize(); z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x++) {
				float tSize = static_cast<float>(terrainPoints->getSize());

				NormText normText{};
				normText.textCoord = glm::vec2 { static_cast<float>(x) / tSize * textureTerrainScale, static_cast<float>(z) / tSize * textureTerrainScale };
				normText.normal = glm::vec4{ 0.0f };

				this->normTexts.emplace_back(normText);
			}
		}
	}

	void TerrainMesh::generateNormals(TerrainPoints* terrainPoints, float worldScale) {
		for (size_t i = 0; i < this->indices.size(); i += 3) {
			uint32_t index0 = this->indices[i];
			uint32_t index1 = this->indices[i + 1];
			uint32_t index2 = this->indices[i + 2];

			glm::vec3 vertexPosition0 = glm::vec3(this->vertices[index0].position);
			glm::vec3 vertexPosition1 = glm::vec3(this->vertices[index1].position);
			glm::vec3 vertexPosition2 = glm::vec3(this->vertices[index2].position);

			glm::vec3 edgeV0toV1 = vertexPosition1 - vertexPosition0;
			glm::vec3 edgeV0toV2 = vertexPosition2 - vertexPosition0;

			glm::vec3 totalNormal = glm::cross(edgeV0toV1, edgeV0toV2);
			if (totalNormal.y < 0) {
				totalNormal *= -1.0f;
			}

			this->normTexts[index0].normal += glm::vec4{ totalNormal, 0.0f };
			this->normTexts[index1].normal += glm::vec4{ totalNormal, 0.0f };
			this->normTexts[index2].normal += glm::vec4{ totalNormal, 0.0f };
		}

		for (size_t i = 0; i < this->normTexts.size(); i++) {
			this->normTexts[i].normal = glm::normalize(this->normTexts[i].normal);
		}
	}
}