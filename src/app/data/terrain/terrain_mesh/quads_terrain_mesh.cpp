#include "quads_terrain_mesh.hpp"

namespace NugieApp {
	void QuadTerrainMesh::convertPointsToMeshes(TerrainPoints* terrainPoints, float worldScale) {
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
				vertex.position = glm::vec4 { x * worldScale, y, z * worldScale, 1.0f };

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

		uint32_t totalIndex = 0u;
		for (uint32_t i = 0; i < static_cast<uint32_t>(this->indices.size()); i += 4) {
			Aabb aabb{};

			glm::vec4 max1 = glm::max(this->vertices[this->indices[i + 0]].position, this->vertices[this->indices[i + 1]].position);
			glm::vec4 max2 = glm::max(this->vertices[this->indices[i + 2]].position, this->vertices[this->indices[i + 3]].position);
			glm::vec4 maxPoint = glm::max(max1, max2);

			glm::vec4 min1 = glm::min(this->vertices[this->indices[i + 0]].position, this->vertices[this->indices[i + 1]].position);
			glm::vec4 min2 = glm::min(this->vertices[this->indices[i + 2]].position, this->vertices[this->indices[i + 3]].position);
			glm::vec4 minPoint = glm::min(min1, min2);

			aabb.point0 = glm::vec4{ minPoint.x, minPoint.y, minPoint.z, 1.0f };
			aabb.point1 = glm::vec4{ maxPoint.x, minPoint.y, minPoint.z, 1.0f };
			aabb.point2 = glm::vec4{ maxPoint.x, minPoint.y, maxPoint.z, 1.0f };
			aabb.point3 = glm::vec4{ minPoint.x, minPoint.y, maxPoint.z, 1.0f };

			aabb.point4 = glm::vec4{ minPoint.x, maxPoint.y, minPoint.z, 1.0f };
			aabb.point5 = glm::vec4{ maxPoint.x, maxPoint.y, minPoint.z, 1.0f };
			aabb.point6 = glm::vec4{ maxPoint.x, maxPoint.y, maxPoint.z, 1.0f };
			aabb.point7 = glm::vec4{ minPoint.x, maxPoint.y, maxPoint.z, 1.0f };

			aabb.indicesCount = 4;
			aabb.firstIndex = totalIndex;

			totalIndex += aabb.indicesCount;
			this->aabbs.emplace_back(aabb);
		}		
	}

	void QuadTerrainMesh::convertPointsToMeshes(TerrainPoints* terrainPoints, uint32_t patchSize, float worldScale) {
		uint32_t patchCount = terrainPoints->getSize() / patchSize + 1;

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

		float y;
		for (uint32_t z = 0; z < patchCount; z++) {
			for (uint32_t x = 0; x < patchCount; x++) {
				y = terrainPoints->get(x * patchCount, z * patchCount);

				Vertex vertex{};
				vertex.position = glm::vec4 { x * patchCount * worldScale, y, z * patchCount * worldScale, 1.0f };

				this->vertices.emplace_back(vertex);
			}
		}

		for (uint32_t z = 0; z < patchCount; z++) {
			for (uint32_t x = 0; x < patchCount; x++) {
				float tSize = static_cast<float>(terrainPoints->getSize());

				NormText normText{};
				normText.textCoord = glm::vec2 { static_cast<float>(x * patchCount) / tSize, static_cast<float>(z * patchCount) / tSize };

				this->normTexts.emplace_back(normText);
			}
		}

		uint32_t totalIndex = 0u;
		for (uint32_t i = 0; i < static_cast<uint32_t>(this->indices.size()); i += 4) {
			Aabb aabb{};

			glm::vec4 max1 = glm::max(this->vertices[this->indices[i + 0]].position, this->vertices[this->indices[i + 1]].position);
			glm::vec4 max2 = glm::max(this->vertices[this->indices[i + 2]].position, this->vertices[this->indices[i + 3]].position);
			glm::vec4 maxPoint = glm::max(max1, max2);

			glm::vec4 min1 = glm::min(this->vertices[this->indices[i + 0]].position, this->vertices[this->indices[i + 1]].position);
			glm::vec4 min2 = glm::min(this->vertices[this->indices[i + 2]].position, this->vertices[this->indices[i + 3]].position);
			glm::vec4 minPoint = glm::min(min1, min2);

			aabb.point0 = glm::vec4{ minPoint.x, minPoint.y, minPoint.z, 1.0f };
			aabb.point1 = glm::vec4{ maxPoint.x, minPoint.y, minPoint.z, 1.0f };
			aabb.point2 = glm::vec4{ maxPoint.x, minPoint.y, maxPoint.z, 1.0f };
			aabb.point3 = glm::vec4{ minPoint.x, minPoint.y, maxPoint.z, 1.0f };

			aabb.point4 = glm::vec4{ minPoint.x, maxPoint.y, minPoint.z, 1.0f };
			aabb.point5 = glm::vec4{ maxPoint.x, maxPoint.y, minPoint.z, 1.0f };
			aabb.point6 = glm::vec4{ maxPoint.x, maxPoint.y, maxPoint.z, 1.0f };
			aabb.point7 = glm::vec4{ minPoint.x, maxPoint.y, maxPoint.z, 1.0f };

			aabb.indicesCount = 4;
			aabb.firstIndex = totalIndex;

			totalIndex += aabb.indicesCount;
			this->aabbs.emplace_back(aabb);
		}
	}
}