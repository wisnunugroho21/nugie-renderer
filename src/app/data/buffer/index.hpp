#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"

#include <vector>
#include <memory>

namespace NugieApp {
	template <typename T>
	class IndexBufferObject {
		public:
			IndexBufferObject(NugieVulkan::Device* device);
			~IndexBufferObject();

			VkDescriptorBufferInfo getInfo() const { return this->buffer->descriptorInfo(); }
			NugieVulkan::Buffer* getBuffer() const { return this->buffer; }
			uint32_t size() const { return this->count; }

			void replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects);
			
		private:
			NugieVulkan::Device* device;
			uint32_t count;

			NugieVulkan::Buffer* stagingBuffer;
			NugieVulkan::Buffer* buffer;

			void createBuffers();
	};

	template <typename T>
	IndexBufferObject<T>::IndexBufferObject(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	template <typename T>
	IndexBufferObject<T>::~IndexBufferObject() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	template <typename T>
	void IndexBufferObject<T>::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(T));

		this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VMA_MEMORY_USAGE_AUTO,
			VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
		);

		this->buffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_INDEX_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VMA_MEMORY_USAGE_AUTO,
			VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
		);

		this->stagingBuffer->map();
	}

	template <typename T>
	void IndexBufferObject<T>::replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects) {
		this->count = static_cast<uint32_t>(objects.size());
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(T)) * static_cast<VkDeviceSize>(this->count);
		
		this->stagingBuffer->writeToBuffer((void *) objects.data(), bufferSize);
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp
