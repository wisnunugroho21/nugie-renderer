#include "reference_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	ReferenceModel::ReferenceModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	ReferenceModel::~ReferenceModel() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	void ReferenceModel::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(Reference));

		this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->buffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void ReferenceModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<Reference> references) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(Reference)) * static_cast<VkDeviceSize>(references.size());

		this->stagingBuffer->map();
		this->stagingBuffer->writeToBuffer((void *) references.data(), bufferSize);
		
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp

